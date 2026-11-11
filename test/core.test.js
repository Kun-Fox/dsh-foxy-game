import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSettings, parseRegion, redact, DEFAULT_PRESET_ID } from '../lib/settings.js'
import { keyToVk, normalizeAction } from '../lib/actions.js'
import { parseDecision } from '../lib/vision.js'
import { nextMove } from '../lib/policy.js'
import { actionToTestGame, describeMemoryState } from '../lib/memory.js'
import { createGame, serialize, step } from '../test-game/game.js'

test('settings normalize clamps numbers and keeps safe defaults', () => {
  const value = normalizeSettings({
    captureIntervalMs: 1,
    maxWidth: 99999,
    jpegQuality: 10,
    mode: 'nonsense',
    enabled: true,
    actionMode: 'foreground',
  })
  assert.equal(value.captureIntervalMs, 300)
  assert.equal(value.maxWidth, 3840)
  assert.equal(value.jpegQuality, 30)
  assert.equal(value.mode, 'screen')
  assert.equal(value.enabled, true)
  assert.equal(value.actionMode, 'foreground')
  assert.equal(value.personaPresetId, DEFAULT_PRESET_ID)
})

test('settings redact hides the API key', () => {
  const value = redact({ visionApiKey: 'secret', visionModel: 'x' })
  assert.equal(value.visionApiKey, '')
  assert.equal(value.visionApiKeySet, true)
})

test('region parser accepts comma and x forms', () => {
  assert.deepEqual(parseRegion('10,20,300,400'), { x: 10, y: 20, w: 300, h: 400 })
  assert.deepEqual(parseRegion('0x80x1280x720'), { x: 0, y: 80, w: 1280, h: 720 })
  assert.equal(parseRegion('bad'), null)
})

test('key mapping and action validation', () => {
  assert.equal(keyToVk('w'), 87)
  assert.equal(keyToVk('F8'), 119)
  assert.deepEqual(normalizeAction({ type: 'key', key: 'W', action: 'press' }), {
    type: 'key', vk: 87, key: 'W', action: 'press', durationMs: 80, modifiers: [],
  })
  assert.deepEqual(normalizeAction({ type: 'none' }), { type: 'wait', ms: 0 })
  assert.throws(() => keyToVk('not-a-key'))
})

test('vision parses fenced JSON and tolerates surrounding prose', () => {
  const value = parseDecision('```json\n{"analysis":"ok","action":{"type":"none"},"say":"","confidence":0.7}\n```')
  assert.equal(value.analysis, 'ok')
  assert.equal(value.action.type, 'none')
  assert.equal(value.confidence, 0.7)
  assert.throws(() => parseDecision('no json here'))
})

test('policy finds a shortest safe step', () => {
  const state = {
    size: 3,
    player: { x: 0, y: 0 },
    goal: { x: 2, y: 2 },
    blocked: ['1,0'],
    won: false,
  }
  const decision = nextMove(state)
  assert.equal(decision.action.type, 'key')
  assert.ok(['down', 'right'].includes(decision.action.key))
})

test('test game moves, blocks and wins', () => {
  const game = createGame({ size: 3, obstacleCount: 0, seed: 1 })
  game.player = { x: 0, y: 0 }
  game.goal = { x: 1, y: 0 }
  const next = step(game, 'right')
  assert.equal(next.player.x, 1)
  assert.equal(next.won, true)
  assert.equal(next.score, 1)
  const blocked = createGame({ size: 3, obstacleCount: 0, seed: 2 })
  blocked.player = { x: 0, y: 0 }
  blocked.goal = { x: 2, y: 2 }
  blocked.blocked.add('1,0')
  const bumped = step(blocked, 'right')
  assert.equal(bumped.player.x, 0)
  assert.equal(bumped.last, 'bump-obstacle')
})

test('memory adapters translate key actions and describe state', () => {
  assert.equal(actionToTestGame({ type: 'key', key: 'w' }), 'up')
  assert.equal(actionToTestGame({ type: 'mouse', x: 1, y: 1 }), null)
  const text = describeMemoryState({ grid: '@..', player: { x: 0, y: 0 }, goal: { x: 2, y: 0 }, steps: 1, won: false })
  assert.match(text, /player=\(0,0\)/)
  assert.match(text, /steps=1/)
})
