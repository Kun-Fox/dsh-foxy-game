const SYSTEM_PROMPT = `你是 Foxy 的游戏操作助手。你看到的是当前游戏窗口的一帧截图。
只输出一个 JSON 对象，不要 Markdown，不要解释 JSON 之外的内容：
{
  "analysis": "你看到的画面、角色/目标/危险，最多 80 字",
  "action": {"type":"key|mouse|wait|none", "...": "见下方"},
  "say": "如果要和玩家说话，一句自然口语；否则空字符串",
  "confidence": 0.0
}

动作格式：
- 键盘：{"type":"key","key":"W","action":"press|down|up","durationMs":80,"modifiers":["shift"]}
- 鼠标：{"type":"mouse","x":0.5,"y":0.5,"button":"left|right|middle","action":"click|down|up|move"}（x/y 是 0~1 的相对窗口坐标）
- 等待：{"type":"wait","ms":300}
- 不操作：{"type":"none"}

规则：
1. 优先短动作；一次只做一个动作。
2. 不确定时用 none，并在 analysis 说明缺什么信息。
3. 不要尝试操作游戏外的窗口、终端、浏览器地址栏或系统设置。
4. 如果画面是加载/黑屏/菜单，明确说明，不要乱按键。
5. 不要编造看不见的数值。`

function endpoint(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('visionBaseUrl is empty')
  if (/\/chat\/completions$/i.test(base)) return base
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`
  return `${base}/chat/completions`
}

export function parseDecision(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('vision model returned empty content')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`vision model did not return JSON: ${raw.slice(0, 240)}`)
  let parsed
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1))
  } catch (error) {
    throw new Error(`vision JSON parse failed: ${error.message}; raw=${raw.slice(0, 300)}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('vision JSON is not an object')
  return {
    analysis: String(parsed.analysis || '').slice(0, 1000),
    action: parsed.action && typeof parsed.action === 'object' ? parsed.action : { type: 'none' },
    say: String(parsed.say || '').slice(0, 500),
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
  }
}

export async function analyzeFrame({ settings, imageBase64, mime = 'image/jpeg', context = {} }) {
  if (!settings.visionApiKey) throw new Error('未配置视觉模型 API Key')
  const game = String(settings.windowTitle || '未知窗口')
  const extra = String(settings.visionPrompt || '').trim()
  const history = Array.isArray(context.history) ? context.history.slice(-6) : []
  const memory = context.memory && typeof context.memory === 'object' ? JSON.stringify(context.memory).slice(0, 2000) : ''
  const region = context.region && typeof context.region === 'object' ? context.region : null
  const userText = [
    `游戏窗口：${game}`,
    region ? `注意：这张截图只包含窗口内的变化区域，区域在原图中的位置是 x=${region.x}, y=${region.y}, w=${region.w}, h=${region.h}（原图 ${region.totalWidth}×${region.totalHeight}）。鼠标 x/y 请相对这张裁剪图。` : '',
    extra ? `额外要求：${extra}` : '',
    memory ? `结构化状态：${memory}` : '',
    history.length ? `最近操作：\n${history.map((item) => `- ${item.action || 'none'} => ${item.analysis || ''}`).join('\n')}` : '',
    '请分析这一帧并给出下一步动作。',
  ].filter(Boolean).join('\n\n')

  const response = await fetch(endpoint(settings.visionBaseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.visionApiKey}`,
    },
    body: JSON.stringify({
      model: settings.visionModel || 'deepseek-chat',
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  })
  const bodyText = await response.text()
  if (!response.ok) throw new Error(`视觉模型 HTTP ${response.status}: ${bodyText.slice(0, 400)}`)
  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    throw new Error(`视觉模型返回非 JSON: ${bodyText.slice(0, 300)}`)
  }
  const content = body?.choices?.[0]?.message?.content
  const text = Array.isArray(content)
    ? content.map((part) => part?.text || '').join('')
    : String(content || '')
  return { ...parseDecision(text), usage: body?.usage || null }
}

export const internals = { endpoint, SYSTEM_PROMPT }
