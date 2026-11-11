import test from 'node:test'
import assert from 'node:assert/strict'
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
  ]) assert.ok(routes.has(path), `missing ${path}`)

  const status = await routes.get('/api/dsh-foxy-game/status').fetch({ method: 'GET' })
  assert.equal(status.status, 200)
  const body = await status.json()
  assert.equal(body.ok, true)
  assert.equal(body.name, 'dsh-foxy-game')
  assert.ok(body.settings && typeof body.settings.enabled === 'boolean')
  assert.ok(Array.isArray(body.logs))
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
