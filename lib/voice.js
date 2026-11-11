import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gameHome } from './settings.js'
import { runPowerShell, scriptsDir } from './capture.js'

const execFileAsync = promisify(execFile)

function ffmpegPath(settings) {
  return settings.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg'
}

export function parseMeanVolume(text) {
  const match = String(text || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/i)
  return match ? Number(match[1]) : null
}

async function meanVolume(settings, path) {
  const exe = ffmpegPath(settings)
  let text = ''
  try {
    const result = await execFileAsync(exe, ['-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], {
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    text = String(result?.stderr || '')
  } catch (error) {
    text = String(error?.stderr || error?.message || '')
  }
  return parseMeanVolume(text)
}

export function parseDshowDevices(text) {
  const devices = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/"([^"]+)"\s+\(audio\)/)
    if (match && !devices.includes(match[1])) devices.push(match[1])
  }
  return devices
}

export class GameVoice {
  constructor(ctx = {}) {
    this.ctx = ctx
    this.settings = null
    this.running = false
    this.recording = null
    this.hotkeyProcess = null
    this.overlayProcess = null
    this.pollTimer = null
    this.callback = null
    this.flagBase = join(gameHome(), 'ptt')
    this.overlayFile = join(gameHome(), 'overlay.txt')
  }

  async listDevices(settings = this.settings) {
    const exe = ffmpegPath(settings || {})
    let text = ''
    try {
      const result = await execFileAsync(exe, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      })
      text = String(result?.stderr || result?.stdout || '')
    } catch (error) {
      text = String(error?.stderr || error?.message || '')
    }
    return parseDshowDevices(text)
  }

  async start(settings, onTranscript) {
    await this.stop()
    this.settings = settings
    this.callback = onTranscript
    this.running = true
    await mkdir(gameHome(), { recursive: true })
    await rm(`${this.flagBase}.down`, { force: true }).catch(() => {})
    await rm(`${this.flagBase}.stop`, { force: true }).catch(() => {})
    if (settings.overlayEnabled) await this.startOverlay()
    if (!settings.voiceEnabled) return { ok: true, overlayOnly: true }
    this.hotkeyProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(scriptsDir(), 'hotkey.ps1'), '-FlagFile', this.flagBase, '-Key', settings.pttKey || 'F8'],
      { windowsHide: true, stdio: 'ignore' },
    )
    this.hotkeyProcess.on('error', (error) => this.ctx.logger?.warn?.(`[foxy-game] hotkey failed: ${error.message}`))
    let wasDown = false
    this.pollTimer = setInterval(async () => {
      const down = await readFile(`${this.flagBase}.down`, 'utf8').then(() => true).catch(() => false)
      if (down && !wasDown) {
        wasDown = true
        await this.startRecording()
      } else if (!down && wasDown) {
        wasDown = false
        await this.stopRecording()
      }
    }, 90)
    return { ok: true, hotkey: settings.pttKey || 'F8', micDevice: settings.micDevice || '' }
  }

  async startOverlay() {
    if (this.overlayProcess) return
    await writeFile(this.overlayFile, '', 'utf8')
    this.overlayProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', join(scriptsDir(), 'overlay.ps1'), '-TextFile', this.overlayFile],
      { windowsHide: true, stdio: 'ignore' },
    )
    this.overlayProcess.on('error', (error) => this.ctx.logger?.warn?.(`[foxy-game] overlay failed: ${error.message}`))
  }

  async startRecording() {
    if (this.recording || !this.settings) return
    if (!this.settings.micDevice) {
      this.ctx.logger?.warn?.('[foxy-game] micDevice is empty; cannot record push-to-talk')
      return
    }
    const path = join(gameHome(), 'ptt.wav')
    await rm(path, { force: true }).catch(() => {})
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'dshow', '-i', `audio=${this.settings.micDevice}`,
      '-t', '60', '-ac', '1', '-ar', '16000', path,
    ]
    const child = spawn(ffmpegPath(this.settings), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
    const exited = new Promise((resolve) => child.once('close', resolve))
    this.recording = { child, path, exited }
    child.on('error', (error) => this.ctx.logger?.warn?.(`[foxy-game] ffmpeg record failed: ${error.message}`))
  }

  async stopRecording() {
    const current = this.recording
    if (!current) return
    this.recording = null
    try { current.child.stdin?.write('q\n') } catch {}
    const graceful = await Promise.race([
      current.exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
    ])
    if (!graceful) current.child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 150))
    try {
      const level = await meanVolume(this.settings, current.path)
      const threshold = Number(this.settings?.pttMinVolumeDb ?? -45)
      if (level !== null && level < threshold) {
        this.ctx.logger?.info?.(`[foxy-game] PTT skipped quiet audio (${level} dB < ${threshold} dB)`)
        return
      }
      const text = await this.transcribe(current.path)
      if (text && this.callback) await this.callback(text)
    } catch (error) {
      this.ctx.logger?.warn?.(`[foxy-game] STT failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async transcribe(path) {
    if (this.settings?.sttProvider === 'dsh') {
      const service = typeof this.ctx.get === 'function' ? this.ctx.get('dshSpeech') : this.ctx.dshSpeech
      if (service?.transcribe) {
        try {
          const result = await service.transcribe({ path })
          const text = typeof result === 'string' ? result : result?.text
          if (text) return text
        } catch (error) {
          this.ctx.logger?.warn?.(`[foxy-game] dshSpeech failed, falling back: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    const python = this.settings?.pythonPath || 'python'
    const modelDir = this.settings?.sttModelDir || ''
    const args = [join(scriptsDir(), 'stt.py'), '--wav', path]
    if (modelDir) args.push('--model', join(modelDir, 'model.int8.onnx'), '--tokens', join(modelDir, 'tokens.txt'))
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)(python, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
    const line = String(stdout).trim().split(/\r?\n/).filter(Boolean).pop()
    const parsed = JSON.parse(line || '{}')
    return String(parsed.text || '')
  }

  async showText(text) {
    const value = String(text || '').trim()
    if (!value) return { ok: true, skipped: true }
    if (this.settings?.overlayEnabled) {
      await writeFile(this.overlayFile, value, 'utf8').catch(() => {})
    }
    return { ok: true }
  }

  async speak(text) {
    const value = String(text || '').trim()
    if (!value) return { ok: true, skipped: true }
    await this.showText(value)
    if (this.settings?.ttsProvider === 'dsh') {
      const service = typeof this.ctx.get === 'function' ? this.ctx.get('dshSpeech') : this.ctx.dshSpeech
      if (service?.synthesize) {
        try {
          const result = await service.synthesize({ text: value })
          if (result?.ok !== false) return { ok: true, provider: 'dsh' }
        } catch (error) {
          this.ctx.logger?.warn?.(`[foxy-game] dshSpeech TTS failed, falling back: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    await runPowerShell('speak.ps1', ['-Text', value], { timeoutMs: 120000 })
    return { ok: true, provider: 'sapi' }
  }

  async stop() {
    this.running = false
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    if (this.recording) {
      try { this.recording.child.stdin?.write('q\n') } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
      this.recording.child.kill('SIGTERM')
      this.recording = null
    }
    await writeFile(`${this.flagBase}.stop`, '1', 'utf8').catch(() => {})
    if (this.hotkeyProcess) this.hotkeyProcess.kill()
    if (this.overlayProcess) this.overlayProcess.kill()
    this.hotkeyProcess = null
    this.overlayProcess = null
    await rm(`${this.flagBase}.down`, { force: true }).catch(() => {})
  }
}
