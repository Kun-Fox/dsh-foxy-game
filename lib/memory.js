const ACTION_ALIASES = {
  up: 'up', w: 'up', arrowup: 'up',
  down: 'down', s: 'down', arrowdown: 'down',
  left: 'left', a: 'left', arrowleft: 'left',
  right: 'right', d: 'right', arrowright: 'right',
  reset: 'reset',
}

export function actionToTestGame(action) {
  if (!action || typeof action !== 'object') return null
  if (action.type === 'key') return ACTION_ALIASES[String(action.key || '').toLowerCase()] || null
  if (action.type === 'mouse') return null
  return null
}

async function readJsonResponse(response) {
  const text = await response.text()
  if (!text) throw new Error(`empty response (HTTP ${response.status})`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response (HTTP ${response.status}): ${text.slice(0, 300)}`)
  }
}

export async function fetchTestGameState(settings) {
  const base = String(settings.memoryUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('memoryUrl is empty')
  const response = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(8000) })
  const body = await readJsonResponse(response)
  if (!response.ok || body.ok === false) throw new Error(body.error || `test game HTTP ${response.status}`)
  return body
}

export async function sendTestGameAction(settings, action) {
  const base = String(settings.memoryUrl || '').replace(/\/+$/, '')
  const semantic = actionToTestGame(action)
  if (!semantic) return { ok: true, skipped: true, reason: 'test game has no mapping for this action' }
  const response = await fetch(`${base}/api/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: semantic }),
    signal: AbortSignal.timeout(8000),
  })
  const body = await readJsonResponse(response)
  if (!response.ok || body.ok === false) throw new Error(body.error || `test game HTTP ${response.status}`)
  return body
}

import { runPowerShell } from './capture.js'

export async function readProcessMemory(settings) {
  const args = []
  if (settings.memoryPid) args.push('-ProcessId', String(settings.memoryPid))
  if (settings.memoryProcess) args.push('-ProcessName', String(settings.memoryProcess))
  if (settings.memoryAddress) args.push('-Address', String(settings.memoryAddress))
  if (settings.memoryModule) args.push('-ModuleName', String(settings.memoryModule))
  if (settings.memoryOffset) args.push('-Offset', String(settings.memoryOffset))
  args.push('-Type', String(settings.memoryType || 'int32'))
  const stdout = await runPowerShell('memory.ps1', args, { timeoutMs: 15000 })
  const text = String(stdout || '').trim()
  const line = text.split(/\r?\n/).reverse().find((entry) => entry.trim().startsWith('{'))
  if (!line) throw new Error(`memory.ps1 returned no JSON: ${text.slice(-300)}`)
  const result = JSON.parse(line)
  if (!result.ok) throw new Error(result.error || 'process memory read failed')
  return result
}

export function describeProcessMemory(state) {
  if (!state || typeof state !== 'object') return ''
  return [
    `process=${state.process || ''} pid=${state.pid || ''}`,
    `module=${state.module || ''} base=${state.base || ''}`,
    `address=${state.address || ''} type=${state.type || ''} value=${state.value}`,
  ].join('\n')
}

export function describeMemoryState(state) {
  if (!state || typeof state !== 'object') return ''
  return [
    `grid:\n${state.grid || ''}`,
    `player=(${state.player?.x},${state.player?.y}) goal=(${state.goal?.x},${state.goal?.y})`,
    `steps=${state.steps} won=${state.won} last=${state.last || ''}`,
  ].join('\n')
}
