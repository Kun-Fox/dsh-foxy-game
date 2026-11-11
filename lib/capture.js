import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { parseRegion } from './settings.js'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const scripts = join(here, '..', 'scripts')

let lastHash = ''

export function scriptsDir() {
  return scripts
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim()
  try {
    return JSON.parse(text)
  } catch {}
  const line = text.split(/\r?\n/).reverse().find((entry) => {
    const trimmed = entry.trim()
    return trimmed.startsWith('{') || trimmed.startsWith('[')
  })
  if (!line) throw new Error(`PowerShell returned no JSON: ${text.slice(-400)}`)
  return JSON.parse(line)
}

export async function runPowerShell(script, args = [], { timeoutMs = 30000 } = {}) {
  const path = join(scripts, script)
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path, ...args],
    { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  )
  if (stderr?.trim()) {
    // PowerShell writes non-fatal Add-Type chatter to stderr on some hosts.
    const meaningful = stderr.trim().split(/\r?\n/).filter((line) => !/^CategoryInfo|^FullyQualifiedErrorId|^\+/.test(line))
    if (meaningful.length && !stdout?.trim()) throw new Error(meaningful.join('\n'))
  }
  return stdout
}

export async function listWindows() {
  const stdout = await runPowerShell('windows.ps1', [], { timeoutMs: 20000 })
  const parsed = parseJsonOutput(stdout)
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  return list.filter((item) => item && item.hwnd && item.width > 0 && item.height > 0)
}

export async function captureWindow(settings = {}, { force = false } = {}) {
  const hwnd = Number(settings.windowHwnd) || 0
  const region = parseRegion(settings.captureRegion)
  const args = [
    '-Hwnd', String(hwnd),
    '-MaxWidth', String(Number(settings.maxWidth) || 1280),
    '-Quality', String(Number(settings.jpegQuality) || 65),
    '-Format', 'jpeg',
  ]
  if (region) args.push('-Region', `${region.x},${region.y},${region.w},${region.h}`)
  const stdout = await runPowerShell('capture.ps1', args, { timeoutMs: 20000 })
  const parsed = parseJsonOutput(stdout)
  if (!parsed?.ok || !parsed.base64) throw new Error(parsed?.error || 'capture failed')
  const hash = createHash('sha256').update(parsed.base64).digest('hex')
  const changed = hash !== lastHash
  if (settings.skipUnchanged !== false && !force && !changed) {
    return {
      ok: true,
      changed: false,
      skipped: true,
      hash,
      width: parsed.width,
      height: parsed.height,
      bytes: parsed.bytes,
      mime: `image/${parsed.format || 'jpeg'}`,
    }
  }
  lastHash = hash
  return {
    ok: true,
    changed: true,
    skipped: false,
    hash,
    width: parsed.width,
    height: parsed.height,
    bytes: parsed.bytes,
    format: parsed.format || 'jpeg',
    mime: `image/${parsed.format || 'jpeg'}`,
    base64: parsed.base64,
  }
}

export function resetCaptureCache() {
  lastHash = ''
}

export const internals = { parseJsonOutput }
