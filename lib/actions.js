import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPowerShell } from './capture.js'

const VK = {
  backspace: 8, tab: 9, enter: 13, return: 13, shift: 16, ctrl: 17, control: 17, alt: 18,
  pause: 19, capslock: 20, escape: 27, esc: 27, space: 32, pageup: 33, pagedown: 34,
  end: 35, home: 36, left: 37, up: 38, right: 39, down: 40, insert: 45, delete: 46,
  '0': 48, '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, '6': 54, '7': 55, '8': 56, '9': 57,
  a: 65, b: 66, c: 67, d: 68, e: 69, f: 70, g: 71, h: 72, i: 73, j: 74, k: 75, l: 76, m: 77,
  n: 78, o: 79, p: 80, q: 81, r: 82, s: 83, t: 84, u: 85, v: 86, w: 87, x: 88, y: 89, z: 90,
  f1: 112, f2: 113, f3: 114, f4: 115, f5: 116, f6: 117, f7: 118, f8: 119, f9: 120, f10: 121, f11: 122, f12: 123,
}

export function keyToVk(key) {
  const text = String(key || '').trim()
  if (!text) throw new Error('key is empty')
  const lower = text.toLowerCase()
  if (VK[lower] !== undefined) return VK[lower]
  if (/^[a-z]$/i.test(text)) return text.toUpperCase().charCodeAt(0)
  if (/^[0-9]$/.test(text)) return text.charCodeAt(0)
  throw new Error(`unsupported key: ${text}`)
}

export function normalizeAction(input) {
  if (!input || typeof input !== 'object') return { type: 'none' }
  const type = String(input.type || '').toLowerCase()
  if (type === 'none' || type === 'wait') {
    return { type: 'wait', ms: Math.min(5000, Math.max(0, Number(input.ms) || 0)) }
  }
  if (type === 'key') {
    const action = ['press', 'down', 'up'].includes(input.action) ? input.action : 'press'
    const modifiers = Array.isArray(input.modifiers)
      ? input.modifiers.slice(0, 4).map(keyToVk)
      : []
    return {
      type: 'key',
      vk: keyToVk(input.key),
      key: String(input.key),
      action,
      durationMs: Math.min(3000, Math.max(20, Number(input.durationMs) || 80)),
      modifiers,
    }
  }
  if (type === 'mouse') {
    const x = Math.min(1, Math.max(0, Number(input.x)))
    const y = Math.min(1, Math.max(0, Number(input.y)))
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('mouse x/y must be numbers')
    return {
      type: 'mouse',
      x,
      y,
      button: ['left', 'right', 'middle'].includes(input.button) ? input.button : 'left',
      action: ['click', 'down', 'up', 'move'].includes(input.action) ? input.action : 'click',
    }
  }
  if (type === 'text') {
    const text = String(input.text || '').slice(0, 500)
    if (!text) return { type: 'none' }
    return { type: 'text', text }
  }
  throw new Error(`unsupported action type: ${type}`)
}

export async function executeAction(settings, input, { hwnd, mode } = {}) {
  const actionMode = mode || settings.actionMode || 'background'
  if (actionMode === 'none') return { ok: true, skipped: true, reason: 'actionMode=none' }
  const action = normalizeAction(input)
  if (action.type === 'none') return { ok: true, skipped: true }
  if (action.type === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, action.ms))
    return { ok: true, action }
  }
  const target = Number(hwnd || settings.windowHwnd) || 0
  if (!target && actionMode === 'background') throw new Error('background input needs a selected window handle')
  if (action.type === 'text' && actionMode !== 'background') throw new Error('text input requires background mode')
  const dir = await mkdtemp(join(tmpdir(), 'foxy-game-'))
  const file = join(dir, 'action.json')
  try {
    await writeFile(file, JSON.stringify(action), 'utf8')
    await runPowerShell('input.ps1', ['-JsonPath', file, '-Hwnd', String(target), '-Mode', actionMode], { timeoutMs: 15000 })
    return { ok: true, action }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export const internals = { VK }
