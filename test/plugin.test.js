import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, internals } from '../lib/index.js'

function mount() {
  const routes = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    provide() {},
    on() {},
    inject(_services, callback) {
      callback({ connection: { fetch: { register(route) { routes.set(route.path, route) } } } })
    },
  }
  const api = apply(ctx)
  return { routes, api }
}

test('plugin registers the expected routes and status shape', async () => {
  const { routes } = mount()
  for (const path of [
    '/api/dsh-foxy-game/status',
    '/api/dsh-foxy-game/settings',
    '/api/dsh-foxy-game/windows',
    '/api/dsh-foxy-game/capture',
    '/api/dsh-foxy-game/observe',
    '/api/dsh-foxy-game/action',
    '/api/dsh-foxy-game/start',
    '/api/dsh-foxy-game/stop',
    '/api/dsh-foxy-game/speak',
    '/api/dsh-foxy-game/audio/devices',
  ]) assert.ok(routes.has(path), `missing ${path}`)

  const status = await routes.get('/api/dsh-foxy-game/status').fetch({ method: 'GET' })
  assert.equal(status.status, 200)
  const body = await status.json()
  assert.equal(body.ok, true)
  assert.equal(body.name, 'dsh-foxy-game')
  assert.ok(body.settings && typeof body.settings.enabled === 'boolean')
  assert.ok(Array.isArray(body.logs))

  const audio = await routes.get('/api/dsh-foxy-game/audio/devices').fetch({ method: 'GET' })
  assert.equal(audio.status, 200)
  const devices = await audio.json()
  assert.equal(devices.ok, true)
  assert.ok(Array.isArray(devices.devices))
})

test('settings route returns presets and never leaks the key', async () => {
  const { routes } = mount()
  const response = await routes.get('/api/dsh-foxy-game/settings').fetch({ method: 'GET' })
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.settings.visionApiKey, '')
  assert.ok(Array.isArray(body.presets))
  assert.ok(body.presets.every((item) => item.id && item.file))
  assert.equal(body.defaultPreset, 'foxy3')
})

test('capture summaries drop base64 payload', () => {
  const summary = internals.summarizeCapture({ ok: true, base64: 'abc', width: 10, height: 20 })
  assert.equal(summary.base64, undefined)
  assert.equal(summary.width, 10)
})

test('explicit empty visionApiKey clears the saved key', async () => {
  const oldHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'foxy-game-test-'))
  process.env.DSH_HOME = home
  try {
    const { routes } = mount()
    const route = routes.get('/api/dsh-foxy-game/settings')
    const save = (body) => route.fetch(new Request('http://local/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    let response = await save({ visionApiKey: 'secret' })
    let body = await response.json()
    assert.equal(body.settings.visionApiKeySet, true)

    response = await save({ visionApiKey: '' })
    body = await response.json()
    assert.ok(!body.settings.visionApiKeySet)
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(home, { recursive: true, force: true }).catch(() => {})
  }
})
