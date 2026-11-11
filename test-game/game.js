const DIRECTIONS = {
  up: [0, -1], w: [0, -1], arrowup: [0, -1],
  down: [0, 1], s: [0, 1], arrowdown: [0, 1],
  left: [-1, 0], a: [-1, 0], arrowleft: [-1, 0],
  right: [1, 0], d: [1, 0], arrowright: [1, 0],
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a += 0x6D2B79F5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createGame({ size = 7, seed = Date.now(), obstacleCount = 7 } = {}) {
  const random = mulberry32(seed)
  const cells = size * size
  const player = { x: 0, y: 0 }
  const goal = { x: size - 1, y: size - 1 }
  const blocked = new Set()
  while (blocked.size < Math.min(obstacleCount, cells - 3)) {
    const index = Math.floor(random() * cells)
    const x = index % size
    const y = Math.floor(index / size)
    if ((x === 0 && y === 0) || (x === goal.x && y === goal.y)) continue
    blocked.add(`${x},${y}`)
  }
  return {
    size,
    seed,
    player,
    goal,
    blocked,
    steps: 0,
    score: 0,
    won: false,
    last: '',
  }
}

export function serialize(game) {
  const rows = []
  for (let y = 0; y < game.size; y += 1) {
    let row = ''
    for (let x = 0; x < game.size; x += 1) {
      if (game.player.x === x && game.player.y === y) row += '@'
      else if (game.goal.x === x && game.goal.y === y) row += '*'
      else if (game.blocked.has(`${x},${y}`)) row += '#'
      else row += '.'
    }
    rows.push(row)
  }
  return {
    ok: true,
    size: game.size,
    player: { ...game.player },
    goal: { ...game.goal },
    blocked: [...game.blocked],
    steps: game.steps,
    score: game.score,
    won: game.won,
    last: game.last,
    grid: rows.join('\n'),
    legend: '@=you, *=goal, #=wall, .=floor',
    actions: ['up', 'down', 'left', 'right', 'reset'],
  }
}

export function step(game, action) {
  if (game.won) return { ...serialize(game), ok: false, error: 'game already won; reset first' }
  const key = String(action || '').toLowerCase()
  if (key === 'reset') {
    const next = createGame({ size: game.size, seed: game.seed + game.steps + 1, obstacleCount: game.blocked.size })
    Object.assign(game, next)
    game.last = 'reset'
    return serialize(game)
  }
  const direction = DIRECTIONS[key]
  if (!direction) return { ...serialize(game), ok: false, error: `unknown action: ${action}` }
  const nx = game.player.x + direction[0]
  const ny = game.player.y + direction[1]
  if (nx < 0 || ny < 0 || nx >= game.size || ny >= game.size) {
    game.last = 'bump-wall'
  } else if (game.blocked.has(`${nx},${ny}`)) {
    game.last = 'bump-obstacle'
  } else {
    game.player.x = nx
    game.player.y = ny
    game.last = key
    game.steps += 1
    if (nx === game.goal.x && ny === game.goal.y) {
      game.won = true
      game.score += 1
    }
  }
  return serialize(game)
}
