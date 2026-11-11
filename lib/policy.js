const MOVES = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
]

export function nextMove(state) {
  if (!state || state.won) return { analysis: '游戏已经完成。', action: { type: 'none' }, say: '', confidence: 1 }
  const size = Number(state.size) || 7
  const blocked = new Set(state.blocked || [])
  const start = `${state.player?.x},${state.player?.y}`
  const goal = `${state.goal?.x},${state.goal?.y}`
  if (!state.player || !state.goal) return { analysis: '状态缺少玩家或目标。', action: { type: 'none' }, say: '', confidence: 0.2 }
  const queue = [start]
  const previous = new Map([[start, null]])
  while (queue.length) {
    const current = queue.shift()
    if (current === goal) break
    const [x, y] = current.split(',').map(Number)
    for (const [direction, dx, dy] of MOVES) {
      const nx = x + dx
      const ny = y + dy
      const key = `${nx},${ny}`
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
      if (blocked.has(key) || previous.has(key)) continue
      previous.set(key, { current, direction })
      queue.push(key)
    }
  }
  if (!previous.has(goal)) {
    return { analysis: '目标被障碍完全围住，暂时走不到。', action: { type: 'none' }, say: '这条路被堵住了。', confidence: 0.4 }
  }
  let cursor = goal
  let first = null
  while (previous.get(cursor)) {
    const entry = previous.get(cursor)
    first = entry.direction
    cursor = entry.current
  }
  return {
    analysis: `玩家在 (${state.player.x},${state.player.y})，目标在 (${state.goal.x},${state.goal.y})。`,
    action: { type: 'key', key: first, action: 'press', durationMs: 60 },
    say: '',
    confidence: 1,
  }
}
