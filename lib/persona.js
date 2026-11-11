import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_PERSONA = '你是 Foxy，一只陪 kunfox 打游戏的狐狸。说话自然、随性，像一个真实的人，不要像客服或说明书。'
const MAX_PERSONA_CHARS = 4000

export function presetsDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'foxy', 'presets')
}

export function parsePersonaYaml(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => /^persona:\s*(.*)$/.test(line))
  if (start < 0) return ''
  const inline = lines[start].replace(/^persona:\s*/, '').trim()
  if (inline && !/^[|>]/.test(inline)) return inline.slice(0, MAX_PERSONA_CHARS)
  const body = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() && !/^\s/.test(line)) break
    body.push(line)
  }
  return body
    .map((line) => line.replace(/^ {2}/, ''))
    .join('\n')
    .trim()
    .slice(0, MAX_PERSONA_CHARS)
}

export async function loadPersona(settings = {}) {
  const id = String(settings.personaPresetId || 'foxy3').replace(/\.ya?ml$/i, '').trim() || 'foxy3'
  const path = join(presetsDir(), `${id}.yml`)
  try {
    const text = await readFile(path, 'utf8')
    const persona = parsePersonaYaml(text)
    return persona || DEFAULT_PERSONA
  } catch {
    return DEFAULT_PERSONA
  }
}

export function withPersona(systemPrompt, persona) {
  const identity = String(persona || '').trim()
  if (!identity) return systemPrompt
  return `${systemPrompt}\n\n角色口吻与背景（遵守上面的格式和操作规则；不要复述设定）：\n${identity}`
}

export const internals = { DEFAULT_PERSONA, MAX_PERSONA_CHARS }
