import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureWindow, listWindows, scriptsDir } from './capture.js'
import { executeAction, normalizeAction } from './actions.js'
import { analyzeFrame } from './vision.js'
import { describeMemoryState, describeProcessMemory, fetchTestGameState, readProcessMemory, sendTestGameAction } from './memory.js'
import { nextMove } from './policy.js'
import { GameVoice } from './voice.js'
import { loadPersona, withPersona } from './persona.js'
import { gameHome, readSettings, redact, writeSettings, DEFAULT_PRESET_ID } from './settings.js'

export const name = 'dsh-foxy-game'

const here = dirname(fileURLToPath(import.meta.url))
const packageInfo = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
const VERSION = packageInfo.version || '0.0.0'

export const ROUTES = {
  status: '/api/dsh-foxy-game/status',
  settings: '/api/dsh-foxy-game/settings',
  windows: '/api/dsh-foxy-game/windows',
  capture: '/api/dsh-foxy-game/capture',
  observe: '/api/dsh-foxy-game/observe',
  action: '/api/dsh-foxy-game/action',
  start: '/api/dsh-foxy-game/start',
  stop: '/api/dsh-foxy-game/stop',
  speak: '/api/dsh-foxy-game/speak',
  audio: '/api/dsh-foxy-game/audio/devices',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function parseRequestBody(request) {
  const raw = request?.body
  if (raw && typeof raw.getReader === 'function') {
    const text = await new Response(raw).text()
    return text ? JSON.parse(text) : {}
  }
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) return raw
  if (typeof request?.json === 'function') {
    try { return await request.json() } catch {}
  }
  if (typeof raw === 'string') return raw ? JSON.parse(raw) : {}
  if (raw && (Buffer.isBuffer(raw) || raw instanceof Uint8Array)) {
    const text = Buffer.from(raw).toString('utf8')
    return text ? JSON.parse(text) : {}
  }
  return {}
}

function summarizeCapture(capture) {
  if (!capture) return null
  const { base64, ...rest } = capture
  return rest
}

function parsePresetId(value) {
  return String(value || '').replace(/\.(ya?ml)$/i, '')
}

export async function listLocalPresets() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dir = join(home, 'foxy', 'presets')
  try {
    const { readdir, readFile: readPreset } = await import('node:fs/promises')
    const names = await readdir(dir)
    const rows = []
    for (const entry of names.filter((name) => /\.(ya?ml)$/i.test(name)).sort((a, b) => a.localeCompare(b))) {
      let label = entry.replace(/\.(ya?ml)$/i, '')
      try {
        const text = await readPreset(join(dir, entry), 'utf8')
        const match = text.match(/^\s*name:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)
        if (match?.[1]) label = match[1].trim()
      } catch {}
      rows.push({ id: entry.replace(/\.(ya?ml)$/i, ''), label, file: entry })
    }
    return rows
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export function apply(ctx) {
  const settingsPromise = readSettings().catch(() => null)
  const voice = new GameVoice(ctx)
  const state = {
    running: false,
    busy: false,
    timer: null,
    startedAt: 0,
    settings: null,
    logs: [],
    lastCapture: null,
    lastDecision: null,
    lastMemory: null,
    lastError: '',
    windows: [],
    steps: 0,
    stopHotkeyProcess: null,
  }

  function log(kind, text, extra = {}) {
    const entry = { at: new Date().toISOString(), kind, text: String(text || ''), ...extra }
    state.logs.push(entry)
    const limit = Math.max(10, Number(state.settings?.logLimit) || 80)
    while (state.logs.length > limit) state.logs.shift()
    if (kind === 'error') state.lastError = entry.text
    return entry
  }

  async function settings() {
    if (!state.settings) state.settings = (await settingsPromise) || (await readSettings())
    return state.settings
  }

  async function refreshSettings() {
    state.settings = null
    return settings()
  }

  async function status() {
    const current = await settings()
    return {
      ok: true,
      name,
      version: VERSION,
      running: state.running,
      busy: state.busy,
      startedAt: state.startedAt,
      steps: state.steps,
      settings: redact(current),
      lastCapture: summarizeCapture(state.lastCapture),
      lastDecision: state.lastDecision,
      lastMemory: state.lastMemory,
      lastError: state.lastError,
      logs: state.logs.slice(-60),
      voice: { enabled: current.voiceEnabled, overlay: current.overlayEnabled, running: Boolean(voice.hotkeyProcess || voice.overlayProcess) },
      routes: ROUTES,
    }
  }

  async function ensureTarget(current) {
    const hwnd = Number(current.windowHwnd) || 0
    if (!hwnd && current.mode !== 'memory') {
      if (current.memorySource === 'test-http') return 0
      throw new Error('还没有选择游戏窗口：先刷新窗口并选择 hwnd')
    }
    return hwnd
  }

  async function memoryState(current) {
    if (current.memorySource === 'process') {
      const memory = await readProcessMemory(current)
      state.lastMemory = memory
      return memory
    }
    if (current.memorySource !== 'test-http') return null
    const memory = await fetchTestGameState(current)
    state.lastMemory = { player: memory.player, goal: memory.goal, steps: memory.steps, won: memory.won, last: memory.last }
    return memory
  }

  async function observe({ force = false } = {}) {
    if (state.busy) throw new Error('上一轮观察还没结束')
    const current = await settings()
    if (!current.enabled) throw new Error('插件未启用：先在设置里打开 enabled')
    state.busy = true
    try {
      const hwnd = await ensureTarget(current)
      const memory = await memoryState(current)
      let capture = null
      let decision
      if (current.mode === 'memory' || (!hwnd && current.memorySource === 'test-http')) {
        if (!memory) throw new Error('memory 模式需要 test-http 或 process 状态源')
        decision = current.memorySource === 'process'
          ? { analysis: describeProcessMemory(memory), action: { type: 'none' }, say: '', confidence: 1 }
          : nextMove(memory)
      } else {
        capture = await captureWindow(current, { force, previousPath: join(gameHome(), 'last-frame.jpg') })
        if (capture.skipped) {
          log('skip', '画面没有变化，跳过本轮')
          return { ok: true, skipped: true, decision: null }
        }
        state.lastCapture = summarizeCapture(capture)
        if (current.mode === 'hybrid' && !memory) throw new Error('hybrid 模式需要可用的 memory 状态源')
        decision = await analyzeFrame({
          settings: current,
          imageBase64: capture.base64,
          mime: capture.mime,
          context: {
            region: capture.region || null,
            memory: memory ? JSON.parse(JSON.stringify(memory)) : null,
            history: state.logs
              .filter((entry) => entry.kind === 'decision')
              .slice(-6)
              .map((entry) => ({ action: entry.action, analysis: entry.text })),
          },
        })
        if (decision.say) log('say', decision.say)
      }

      let actionResult = { ok: true, skipped: true }
      if (decision.action && decision.action.type !== 'none') {
        if (current.memorySource === 'test-http') {
          actionResult = await sendTestGameAction(current, decision.action)
        } else {
          actionResult = await executeAction(current, decision.action, { hwnd, region: capture?.region })
        }
      }
      state.lastDecision = { ...decision, at: new Date().toISOString(), actionResult }
      state.steps += 1
      log('decision', decision.analysis || '(no analysis)', {
        action: decision.action,
        say: decision.say || '',
        confidence: decision.confidence,
      })
      if (decision.say && current.voiceEnabled) {
        void voice.speak(decision.say).catch((error) => log('error', `TTS: ${error instanceof Error ? error.message : String(error)}`))
      } else if (decision.say && current.overlayEnabled) {
        void voice.showText(decision.say).catch((error) => log('error', `字幕: ${error instanceof Error ? error.message : String(error)}`))
      }
      return { ok: true, decision, actionResult, capture: summarizeCapture(capture), memory }
    } catch (error) {
      log('error', error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      state.busy = false
    }
  }

  async function loop() {
    if (!state.running) return
    if (await stopRequested()) {
      await stop()
      log('stop', '收到 F12 紧急停止')
      return
    }
    const current = await settings()
    const started = Date.now()
    try {
      await observe({ force: false })
    } catch (error) {
      log('error', error instanceof Error ? error.message : String(error))
    }
    if (!state.running) return
    const interval = Math.max(300, Number(current.captureIntervalMs) || 1500)
    const rateDelay = Math.ceil(60000 / Math.max(1, Number(current.maxStepsPerMinute) || 20))
    const elapsed = Date.now() - started
    state.timer = setTimeout(() => void loop(), Math.max(interval, rateDelay - elapsed, 250))
  }

  function stopFlagPath() {
    return join(gameHome(), 'auto.stop')
  }

  async function stopRequested() {
    return readFile(stopFlagPath(), 'utf8').then(() => true).catch(() => false)
  }

  async function startStopHotkey() {
    if (state.stopHotkeyProcess) return
    await rm(stopFlagPath(), { force: true }).catch(() => {})
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', join(scriptsDir(), 'stop-hotkey.ps1'), '-FlagFile', stopFlagPath(), '-Key', 'F12'],
      { windowsHide: true, stdio: 'ignore' },
    )
    child.on('error', (error) => log('error', `紧急停止热键启动失败：${error.message}`))
    state.stopHotkeyProcess = child
  }

  async function start() {
    const current = await settings()
    if (!current.enabled) throw new Error('插件未启用：先打开 enabled')
    await ensureTarget(current)
    if (state.running) return { ok: true, alreadyRunning: true }
    state.running = true
    state.startedAt = Date.now()
    state.steps = 0
    await rm(join(gameHome(), 'last-frame.jpg'), { force: true }).catch(() => {})
    await startStopHotkey()
    if (current.voiceEnabled || current.overlayEnabled) {
      await voice.start(current, (text) => onVoiceTranscript(text))
    }
    log('start', '自动游戏循环已启动')
    void loop()
    return { ok: true, running: true }
  }

  async function stop() {
    state.running = false
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    if (state.stopHotkeyProcess) state.stopHotkeyProcess.kill()
    state.stopHotkeyProcess = null
    await rm(stopFlagPath(), { force: true }).catch(() => {})
    await voice.stop()
    log('stop', '自动游戏循环已停止')
    return { ok: true, running: false }
  }

  async function onVoiceTranscript(text) {
    const value = String(text || '').trim()
    if (!value) return
    log('voice', value)
    try {
      if (state.lastMemory?.won) {
        await voice.speak('这局已经完成啦。')
        return
      }
      const current = await settings()
      const reply = current.visionApiKey
        ? await askText(current, value)
        : `我听到了：${value}`
      log('say', reply)
      await voice.speak(reply)
    } catch (error) {
      log('error', `语音回复失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function askText(current, text) {
    const persona = await loadPersona(current)
    const response = await fetch(`${String(current.visionBaseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${current.visionApiKey}` },
      body: JSON.stringify({
        model: current.visionModel || 'deepseek-chat',
        temperature: 0.8,
        max_tokens: 300,
        messages: [
          { role: 'system', content: withPersona('你是 Foxy，正在陪玩家玩游戏。用中文自然口语回答，最多两句话，不要解释设定。', persona) },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`)
    return String(body?.choices?.[0]?.message?.content || '').trim() || '嗯，我在听。'
  }

  async function handleSettings(request) {
    if (request.method === 'GET') {
      const current = await settings()
      return json({ ok: true, settings: redact(current), presets: await listLocalPresets(), defaultPreset: DEFAULT_PRESET_ID })
    }
    let patch
    try { patch = await parseRequestBody(request) } catch { return json({ ok: false, error: 'invalid JSON body' }, 400) }
    const current = await settings()
    if (!Object.prototype.hasOwnProperty.call(patch, 'visionApiKey')) patch.visionApiKey = current.visionApiKey
    if (!patch.memoryPresetId && patch.memoryPresetId !== '') patch.memoryPresetId = current.memoryPresetId
    const next = await writeSettings({ ...current, ...patch })
    state.settings = next
    if (state.running) {
      await voice.stop()
      if (next.voiceEnabled || next.overlayEnabled) await voice.start(next, (text) => onVoiceTranscript(text))
    }
    log('settings', '设置已保存')
    return json({ ok: true, settings: redact(next), presets: await listLocalPresets(), defaultPreset: DEFAULT_PRESET_ID })
  }

  const service = {
    version: 1,
    contract: 'foxy-game/1',
    status,
    refresh: refreshSettings,
    start,
    stop,
    observe,
    getSettings: settings,
    listPresets: listLocalPresets,
  }
  if (typeof ctx.provide === 'function') ctx.provide('foxyGame', service)
  else if (typeof ctx.set === 'function') ctx.set('foxyGame', service)

  ctx.inject?.(['connection'], (host) => {
    const register = host?.connection?.fetch?.register
    if (typeof register !== 'function') return
    const add = (path, methods, fetch) => {
      try {
        register({ path, methods, requestBody: 'buffered', fetch })
      } catch (error) {
        ctx.logger?.warn?.(`[foxy-game] route ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    add(ROUTES.status, ['GET'], async () => json(await status()))
    add(ROUTES.settings, ['GET', 'POST'], async (request) => {
      try { return await handleSettings(request) } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
    add(ROUTES.windows, ['GET'], async () => {
      try {
        state.windows = await listWindows()
        return json({ ok: true, windows: state.windows })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
    add(ROUTES.capture, ['POST'], async (request) => {
      try {
        const current = await settings()
        const capture = await captureWindow(current, { force: true })
        state.lastCapture = summarizeCapture(capture)
        log('capture', `截图 ${capture.width}×${capture.height}，${Math.round((capture.bytes || 0) / 1024)} KB`)
        return json({ ok: true, ...capture })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
    add(ROUTES.observe, ['POST'], async (request) => {
      try {
        let body = {}
        try { body = await parseRequestBody(request) } catch {}
        const result = await observe({ force: body.force === true })
        return json(result)
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
    add(ROUTES.action, ['POST'], async (request) => {
      try {
        const body = await parseRequestBody(request)
        const current = await settings()
        const action = normalizeAction(body.action || body)
        if (current.memorySource === 'test-http') return json(await sendTestGameAction(current, action))
        return json(await executeAction(current, action, { hwnd: current.windowHwnd }))
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
    add(ROUTES.start, ['POST'], async () => {
      try { return json(await start()) } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
    add(ROUTES.stop, ['POST'], async () => json(await stop()))
    add(ROUTES.speak, ['POST'], async (request) => {
      try {
        const body = await parseRequestBody(request)
        const current = await settings()
        if (!current.voiceEnabled) return json({ ok: false, error: 'voiceEnabled is false' }, 400)
        return json(await voice.speak(body.text || ''))
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
    add(ROUTES.audio, ['GET'], async () => {
      try {
        const current = await settings()
        return json({ ok: true, devices: await voice.listDevices(current) })
      } catch (error) {
        return json({ ok: false, devices: [], error: error instanceof Error ? error.message : String(error) }, 500)
      }
    })
  })

  ctx.on?.('dispose', () => { void stop() })
  ctx.logger?.info?.(`[foxy-game] ready; settings=${join(gameHome(), 'settings.json')}`)
  return { service, status }
}

export const internals = {
  parseRequestBody,
  summarizeCapture,
  parsePresetId,
}
