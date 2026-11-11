import { withPersona } from './persona.js'

const BASE = '你是 Foxy，正在陪玩家玩游戏。用中文自然口语回答，最多两句话，不要解释设定。'

export function buildVoiceMessages({ text, persona = '', game = '', analysis = '', history = [] } = {}) {
  const context = []
  if (game) context.push(`当前游戏窗口：${game}`)
  if (analysis) context.push(`刚才画面：${analysis}`)
  const system = withPersona(`${BASE}${context.length ? `\n${context.join('\n')}` : ''}`, persona)
  const messages = [{ role: 'system', content: system }]
  for (const item of Array.isArray(history) ? history.slice(-8) : []) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant') || !item.content) continue
    messages.push({ role: item.role, content: String(item.content).slice(0, 1000) })
  }
  messages.push({ role: 'user', content: String(text || '').trim() })
  return messages
}
