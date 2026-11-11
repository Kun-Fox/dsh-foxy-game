import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createGame, serialize, step } from './game.js'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || process.argv[2] || 8787)
const game = createGame({ size: 7, seed: Number(process.env.SEED || 12345), obstacleCount: 7 })

function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`)
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(join(here, 'index.html'), 'utf8')
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(html)
      return
    }
    if (request.method === 'GET' && (url.pathname === '/api/state' || url.pathname === '/state')) {
      return json(response, serialize(game))
    }
    if (request.method === 'POST' && (url.pathname === '/api/action' || url.pathname === '/action')) {
      const payload = await body(request)
      return json(response, step(game, payload.action || payload.key || payload.type))
    }
    json(response, { ok: false, error: 'not found' }, 404)
  } catch (error) {
    json(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[foxy-game] test game on http://127.0.0.1:${port}`)
})
