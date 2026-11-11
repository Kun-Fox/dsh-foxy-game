import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { parseRegion } from './settings.js'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const scripts = join(here, '..', 'scripts')
const DEFAULT_FFMPEG = 'F:\\kunfox\\ffmpeg-8.1.2-essentials_build\\bin\\ffmpeg.exe'

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

export function ffmpegPath(settings = {}) {
  return String(settings.ffmpegPath || process.env.FFMPEG_PATH || '').trim() || DEFAULT_FFMPEG
}

function parseBBox(stderr) {
  const text = String(stderr || '')
  const match = text.match(/x1:(\d+)\s+x2:(\d+)\s+y1:(\d+)\s+y2:(\d+)\s+w:(\d+)\s+h:(\d+)/)
  if (!match) return null
  const [, x1, x2, y1, y2, w, h] = match.map(Number)
  if (![x1, x2, y1, y2, w, h].every(Number.isFinite)) return null
  return { x: x1, y: y1, w, h, x2, y2 }
}

async function runFfmpeg(settings, args, timeoutMs = 20000) {
  const { stderr } = await execFileAsync(ffmpegPath(settings), ['-hide_banner', '-loglevel', 'info', ...args], {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  return stderr
}

export async function diffBBox(settings, previousPath, currentBuffer) {
  const dir = await mkdtemp(join(tmpdir(), 'foxy-diff-'))
  const currentPath = join(dir, 'current.jpg')
  try {
    await writeFile(currentPath, currentBuffer)
    const stderr = await runFfmpeg(settings, [
      '-i', previousPath,
      '-i', currentPath,
      '-filter_complex', '[0:v][1:v]blend=all_mode=difference,bbox',
      '-f', 'null',
      '-',
    ])
    return parseBBox(stderr)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function cropJpeg(settings, buffer, box, quality = 65) {
  const dir = await mkdtemp(join(tmpdir(), 'foxy-crop-'))
  const inPath = join(dir, 'in.jpg')
  const outPath = join(dir, 'out.jpg')
  try {
    await writeFile(inPath, buffer)
    const q = String(Math.max(2, Math.min(31, Math.round(31 - (Number(quality) || 65) / 3.2))))
    await runFfmpeg(settings, [
      '-i', inPath,
      '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y}`,
      '-q:v', q,
      '-y', outPath,
    ])
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export function padBox(box, totalWidth, totalHeight, padding = 24) {
  if (!box) return null
  const x = Math.max(0, box.x - padding)
  const y = Math.max(0, box.y - padding)
  const right = Math.min(totalWidth, box.x + box.w + padding)
  const bottom = Math.min(totalHeight, box.y + box.h + padding)
  return {
    x,
    y,
    w: Math.max(2, right - x),
    h: Math.max(2, bottom - y),
  }
}

export async function captureWindow(settings = {}, { force = false, previousPath = '' } = {}) {
  const hwnd = Number(settings.windowHwnd) || 0
  const region = parseRegion(settings.captureRegion)
  const args = [
    '-Hwnd', String(hwnd),
    '-MaxWidth', String(Number(settings.maxWidth) || 1280),
    '-Quality', String(Number(settings.jpegQuality) || 65),
    '-Format', 'jpeg',
    '-Method', String(settings.captureMethod || 'auto'),
  ]
  if (region) args.push('-Region', `${region.x},${region.y},${region.w},${region.h}`)
  const stdout = await runPowerShell('capture.ps1', args, { timeoutMs: 20000 })
  const parsed = parseJsonOutput(stdout)
  if (!parsed?.ok || !parsed.base64) throw new Error(parsed?.error || 'capture failed')
  const full = Buffer.from(parsed.base64, 'base64')
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
      captureMethod: parsed.method || '',
    }
  }
  lastHash = hash

  let output = full
  let width = Number(parsed.width) || 0
  let height = Number(parsed.height) || 0
  let crop = null
  if (previousPath && settings.cropChanges && !region) {
    const previous = await readFile(previousPath).catch(() => null)
    if (previous) {
      try {
        const rawBox = await diffBBox(settings, previousPath, full)
        const box = padBox(rawBox, width, height, Number(settings.changePadding) || 24)
        const ratio = box ? (box.w * box.h) / Math.max(1, width * height) : 1
        if (box && ratio >= 0.002 && ratio <= 0.92) {
          output = await cropJpeg(settings, full, box, settings.jpegQuality)
          width = box.w
          height = box.h
          crop = {
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            totalWidth: Number(parsed.width) || width,
            totalHeight: Number(parsed.height) || height,
          }
        }
      } catch {
        // Diff/crop is an optimization; never turn it into a capture failure.
      }
    }
    await writeFile(previousPath, full).catch(() => {})
  }

  return {
    ok: true,
    changed: true,
    skipped: false,
    hash,
    width,
    height,
    bytes: output.length,
    format: 'jpeg',
    mime: 'image/jpeg',
    captureMethod: parsed.method || '',
    base64: output.toString('base64'),
    region: crop,
    fullWidth: Number(parsed.width) || width,
    fullHeight: Number(parsed.height) || height,
  }
}

export function resetCaptureCache() {
  lastHash = ''
}

export function mapRegionPoint(region, x, y) {
  if (!region) return { x, y }
  const totalWidth = Number(region.totalWidth) || Number(region.w) || 1
  const totalHeight = Number(region.totalHeight) || Number(region.h) || 1
  return {
    x: Math.min(1, Math.max(0, (Number(region.x) + Number(x) * Number(region.w)) / totalWidth)),
    y: Math.min(1, Math.max(0, (Number(region.y) + Number(y) * Number(region.h)) / totalHeight)),
  }
}

export const internals = { parseJsonOutput, parseBBox }
