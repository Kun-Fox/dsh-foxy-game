import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_PRESET_ID = 'foxy3'

export const DEFAULTS = {
  enabled: false,
  mode: 'screen',
  windowHwnd: 0,
  windowTitle: '',
  captureIntervalMs: 1500,
  skipUnchanged: true,
  maxWidth: 1280,
  jpegQuality: 65,
  captureRegion: '',
  visionBaseUrl: 'https://api.deepseek.com',
  visionApiKey: '',
  visionModel: 'deepseek-chat',
  visionPrompt: '',
  actionMode: 'background',
  autoPlay: false,
  maxStepsPerMinute: 20,
  memorySource: 'none',
  memoryUrl: 'http://127.0.0.1:8787',
  memoryPresetId: '',
  voiceEnabled: false,
  pttKey: 'F8',
  micDevice: '',
  ttsProvider: 'sapi',
  overlayEnabled: true,
  sttProvider: 'sensevoice',
  sttModelDir: '',
  ffmpegPath: '',
  pythonPath: 'python',
  personaPresetId: DEFAULT_PRESET_ID,
  logLimit: 80,
}

export const MODES = new Set(['screen', 'memory', 'hybrid'])
export const ACTION_MODES = new Set(['background', 'foreground', 'none'])
export const MEMORY_SOURCES = new Set(['none', 'test-http'])
export const TTS_PROVIDERS = new Set(['sapi', 'dsh'])
export const STT_PROVIDERS = new Set(['sensevoice', 'dsh'])

const BOOLEAN_KEYS = new Set([
  'enabled',
  'skipUnchanged',
  'autoPlay',
  'voiceEnabled',
  'overlayEnabled',
])
const NUMBER_KEYS = new Map([
  ['windowHwnd', [0, Number.MAX_SAFE_INTEGER]],
  ['captureIntervalMs', [300, 60000]],
  ['maxWidth', [320, 3840]],
  ['jpegQuality', [30, 95]],
  ['maxStepsPerMinute', [1, 120]],
  ['logLimit', [10, 500]],
])
const ENUM_KEYS = new Map([
  ['mode', MODES],
  ['actionMode', ACTION_MODES],
  ['memorySource', MEMORY_SOURCES],
  ['ttsProvider', TTS_PROVIDERS],
  ['sttProvider', STT_PROVIDERS],
])

export function gameHome() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'foxy-game')
}

export function settingsPath() {
  return join(gameHome(), 'settings.json')
}

function clamp(value, [min, max]) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function normalizeSettings(input = {}, base = DEFAULTS) {
  const next = { ...DEFAULTS, ...base }
  for (const [key, value] of Object.entries(input || {})) {
    if (!(key in DEFAULTS)) continue
    if (BOOLEAN_KEYS.has(key)) next[key] = value === true
    else if (NUMBER_KEYS.has(key)) next[key] = clamp(value, NUMBER_KEYS.get(key))
    else if (ENUM_KEYS.has(key)) {
      const allowed = ENUM_KEYS.get(key)
      next[key] = allowed.has(String(value)) ? String(value) : DEFAULTS[key]
    } else next[key] = String(value ?? '')
  }
  if (!next.windowTitle) next.windowTitle = ''
  if (!next.captureRegion) next.captureRegion = ''
  return next
}

export async function readSettings() {
  let parsed = {}
  try {
    parsed = JSON.parse(await readFile(settingsPath(), 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return normalizeSettings(parsed)
}

export async function writeSettings(settings) {
  const next = normalizeSettings(settings)
  await mkdir(dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function parseRegion(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const parts = text.split(/[,x\s]+/).map(Number).filter((n) => Number.isFinite(n))
  if (parts.length !== 4) return null
  const [x, y, w, h] = parts.map((n) => Math.max(0, Math.round(n)))
  if (w < 2 || h < 2) return null
  return { x, y, w, h }
}

export function redact(settings) {
  const copy = { ...settings }
  if (copy.visionApiKey) copy.visionApiKeySet = true
  copy.visionApiKey = ''
  return copy
}
