window.__ModuleLoader__.load({
  id: 'dsh-foxy-game',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'dsh-foxy-game'

    function GameIcon({ size = 18 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
        h('rect', { x: 3, y: 6, width: 18, height: 12, rx: 4 }),
        h('path', { d: 'M8 10v4M6 12h4M15.5 11h.01M18 13h.01' }),
      )
    }

    function Row({ label, hint, children }) {
      return h('div', { className: 'fg-row' },
        h('div', { className: 'fg-label' }, h('span', null, label), hint ? h('small', null, hint) : null),
        h('div', { className: 'fg-control' }, children),
      )
    }

    function Check({ checked, onChange, children }) {
      return h('label', { className: 'fg-check' },
        h('input', { type: 'checkbox', checked: Boolean(checked), onChange: (event) => onChange(event.target.checked) }),
        h('span', null, children),
      )
    }

    async function readJson(response) {
      const text = await response.text()
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch {
        throw new Error(text ? `非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 180)}` : `空响应（HTTP ${response.status}）`)
      }
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
      return data
    }

    function GamePage() {
      const [status, setStatus] = React.useState({ loading: true })
      const [settings, setSettings] = React.useState(null)
      const [presets, setPresets] = React.useState([])
      const [windows, setWindows] = React.useState([])
      const [message, setMessage] = React.useState('')
      const [image, setImage] = React.useState('')
      const [nonce, setNonce] = React.useState(0)
      const dirty = React.useRef(false)

      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const data = await readJson(await fetch('/api/dsh-foxy-game/status', { cache: 'no-store', credentials: 'same-origin' }))
            if (alive) setStatus({ ...data, loading: false })
          } catch (error) {
            if (alive) setStatus({ ok: false, loading: false, error: error.message })
          }
        }
        void load()
        const timer = setInterval(load, 3500)
        return () => { alive = false; clearInterval(timer) }
      }, [nonce])

      const loadSettings = async () => {
        try {
          const data = await readJson(await fetch('/api/dsh-foxy-game/settings', { cache: 'no-store', credentials: 'same-origin' }))
          setSettings(data.settings)
          setPresets(data.presets || [])
          dirty.current = false
        } catch (error) { setMessage(error.message) }
      }
      React.useEffect(() => { void loadSettings() }, [])

      const update = (key, value) => {
        dirty.current = true
        setSettings((current) => ({ ...(current || {}), [key]: value }))
      }

      const save = async () => {
        if (!settings) return
        setMessage('保存中…')
        try {
          const data = await readJson(await fetch('/api/dsh-foxy-game/settings', {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(settings),
          }))
          setSettings(data.settings)
          setPresets(data.presets || [])
          setMessage('已保存')
          dirty.current = false
          setNonce((value) => value + 1)
        } catch (error) { setMessage(error.message) }
      }

      const action = async (path, body) => {
        setMessage('执行中…')
        try {
          const data = await readJson(await fetch(path, {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
          }))
          setMessage(data.skipped ? '画面未变化，已跳过' : '完成')
          if (data.base64) setImage(`data:${data.mime};base64,${data.base64}`)
          setNonce((value) => value + 1)
        } catch (error) { setMessage(error.message) }
      }

      const refreshWindows = async () => {
        setMessage('读取窗口…')
        try {
          const data = await readJson(await fetch('/api/dsh-foxy-game/windows', { cache: 'no-store', credentials: 'same-origin' }))
          setWindows(data.windows || [])
          setMessage(`找到 ${data.windows?.length || 0} 个窗口`)
        } catch (error) { setMessage(error.message) }
      }

      React.useEffect(() => {
        if (dirty.current || !settings?.windowHwnd) return
        const current = windows.find((item) => Number(item.hwnd) === Number(settings.windowHwnd))
        if (current && current.title !== settings.windowTitle) {
          setSettings((value) => ({ ...(value || {}), windowTitle: current.title }))
        }
      }, [windows, settings?.windowHwnd])

      const currentWindow = windows.find((item) => Number(item.hwnd) === Number(settings?.windowHwnd))
      const statusTone = status.running ? 'is-live' : status.ok ? 'is-ready' : 'is-bad'
      const last = status.lastDecision

      return h('section', { className: 'fg-page' },
        h('style', null, CSS),
        h('header', { className: 'fg-header' },
          h('div', null,
            h('div', { className: 'fg-kicker' }, 'FOXY EXTENSION'),
            h('h1', null, 'Foxy Game'),
            h('p', null, '把游戏窗口变成可观测、可操作、可交流的闭环。默认不会自动操作。'),
          ),
          h('div', { className: 'fg-actions' },
            h('span', { className: `fg-state ${statusTone}` }, status.running ? '循环中' : status.loading ? '读取中' : '空闲'),
            h('button', { className: 'fg-btn', onClick: () => setNonce((value) => value + 1) }, '刷新'),
          ),
        ),
        status.error ? h('div', { className: 'fg-error' }, status.error) : null,
        h('div', { className: 'fg-summary' },
          h('div', null, h('span', null, '窗口'), h('strong', null, settings?.windowTitle || currentWindow?.title || '未选择'), h('small', null, settings?.windowHwnd ? `hwnd ${settings.windowHwnd}` : '先刷新窗口')),
          h('div', null, h('span', null, '模式'), h('strong', null, settings?.mode || 'screen'), h('small', null, settings?.actionMode === 'background' ? '后台输入' : settings?.actionMode === 'foreground' ? '前台输入' : '只观察')),
          h('div', null, h('span', null, '本轮'), h('strong', null, status.steps || 0), h('small', null, last?.analysis ? last.analysis.slice(0, 52) : '还没有观察')),
        ),
        h('div', { className: 'fg-toolbar' },
          h('button', { className: 'fg-btn', onClick: refreshWindows }, '刷新窗口'),
          h('button', { className: 'fg-btn', onClick: () => action('/api/dsh-foxy-game/capture') }, '截一张'),
          h('button', { className: 'fg-btn', onClick: () => action('/api/dsh-foxy-game/observe', { force: true }) }, '观察一次'),
          h('button', { className: 'fg-btn is-primary', onClick: () => action('/api/dsh-foxy-game/start') }, '开始循环'),
          h('button', { className: 'fg-btn', onClick: () => action('/api/dsh-foxy-game/stop') }, '停止'),
          h('span', { className: 'fg-message' }, message),
        ),
        h('div', { className: 'fg-grid' },
          h('div', { className: 'fg-column' },
            section('窗口与截图',
              h(Row, { label: '游戏窗口', hint: '像 OBS 一样选择；标题只用于显示' },
                h('select', {
                  value: settings?.windowHwnd || 0,
                  onChange: (event) => {
                    const value = Number(event.target.value)
                    const found = windows.find((item) => Number(item.hwnd) === value)
                    update('windowHwnd', value)
                    if (found) update('windowTitle', found.title)
                  },
                },
                  h('option', { value: 0 }, windows.length ? '选择窗口…' : '先点“刷新窗口”'),
                  windows.map((item) => h('option', { key: item.hwnd, value: item.hwnd }, `${item.title}  ·  ${item.process}`)),
                ),
                h('button', { className: 'fg-btn', onClick: refreshWindows }, '扫描'),
              ),
              h(Row, { label: '截图间隔', hint: '毫秒；自动循环的最小间隔' },
                h('input', { type: 'number', min: 300, max: 60000, step: 100, value: settings?.captureIntervalMs || 1500, onChange: (e) => update('captureIntervalMs', Number(e.target.value)) }),
              ),
              h(Row, { label: '缩放宽度', hint: '越小越省 token；默认 1280' },
                h('input', { type: 'number', min: 320, max: 3840, value: settings?.maxWidth || 1280, onChange: (e) => update('maxWidth', Number(e.target.value)) }),
              ),
              h(Row, { label: 'JPEG 质量' },
                h('input', { type: 'number', min: 30, max: 95, value: settings?.jpegQuality || 65, onChange: (e) => update('jpegQuality', Number(e.target.value)) }),
              ),
              h(Row, { label: '跳过未变化', hint: '整图哈希相同就不请求模型' },
                h(Check, { checked: settings?.skipUnchanged, onChange: (v) => update('skipUnchanged', v) }, '开启跳帧'),
              ),
              h(Row, { label: '只截变化区域', hint: '实验：ffmpeg 对比上一帧，只把变化块送模型' },
                h(Check, { checked: settings?.cropChanges, onChange: (v) => update('cropChanges', v) }, '开启变化裁剪'),
              ),
              h(Row, { label: '裁剪区域', hint: '可选：x,y,w,h；相对窗口左上角' },
                h('input', { value: settings?.captureRegion || '', placeholder: '例如 0,80,1280,720', onChange: (e) => update('captureRegion', e.target.value) }),
              ),
            ),
            section('视觉模型',
              h(Row, { label: '接口地址', hint: 'OpenAI 兼容 /chat/completions' },
                h('input', { value: settings?.visionBaseUrl || '', onChange: (e) => update('visionBaseUrl', e.target.value) }),
              ),
              h(Row, { label: '模型' },
                h('input', { value: settings?.visionModel || '', placeholder: '支持图片输入的模型', onChange: (e) => update('visionModel', e.target.value) }),
              ),
              h(Row, { label: 'API Key', hint: settings?.visionApiKeySet ? '已保存；留空表示不修改' : '只存在本机' },
                h('input', { type: 'password', value: settings?.visionApiKey || '', placeholder: settings?.visionApiKeySet ? '已保存，留空不修改' : 'sk-…', onChange: (e) => update('visionApiKey', e.target.value) }),
              ),
              h(Row, { label: '感知模式' },
                h('select', { value: settings?.mode || 'screen', onChange: (e) => update('mode', e.target.value) },
                  h('option', { value: 'screen' }, '屏幕识别'),
                  h('option', { value: 'hybrid' }, '屏幕 + 结构化状态'),
                  h('option', { value: 'memory' }, '只读结构化状态'),
                ),
              ),
              h(Row, { label: '额外提示', hint: '告诉模型这游戏的规则/目标' },
                h('textarea', { rows: 3, value: settings?.visionPrompt || '', onChange: (e) => update('visionPrompt', e.target.value) }),
              ),
            ),
            section('动作与安全',
              h(Row, { label: '输入方式' },
                h('select', { value: settings?.actionMode || 'background', onChange: (e) => update('actionMode', e.target.value) },
                  h('option', { value: 'background' }, '后台 SendMessage（不抢前台）'),
                  h('option', { value: 'foreground' }, '前台 SendInput（兼容性优先）'),
                  h('option', { value: 'none' }, '只观察，不操作'),
                ),
              ),
              h(Row, { label: '自动循环' },
                h(Check, { checked: settings?.enabled, onChange: (v) => update('enabled', v) }, '允许启动自动循环'),
              ),
              h(Row, { label: '每分钟上限' },
                h('input', { type: 'number', min: 1, max: 120, value: settings?.maxStepsPerMinute || 20, onChange: (e) => update('maxStepsPerMinute', Number(e.target.value)) }),
              ),
              h(Row, { label: '紧急停止', hint: '循环运行时全局生效，不需要切回页面' },
                h('span', { className: 'fg-message' }, 'F12'),
              ),
              h(Row, { label: '结构化状态源', hint: '自测游戏用 test-http；process 为只读进程内存' },
                h('select', { value: settings?.memorySource || 'none', onChange: (e) => update('memorySource', e.target.value) },
                  h('option', { value: 'none' }, '不读取'),
                  h('option', { value: 'test-http' }, 'HTTP 自测游戏'),
                  h('option', { value: 'process' }, '只读进程内存（实验）'),
                ),
                h('input', { value: settings?.memoryUrl || '', placeholder: 'http://127.0.0.1:8787', onChange: (e) => update('memoryUrl', e.target.value) }),
              ),
              settings?.memorySource === 'process' ? h(Row, { label: '目标进程', hint: '进程名或 PID；地址/偏移为十六进制' },
                h('input', { value: settings?.memoryProcess || '', placeholder: 'game.exe', onChange: (e) => update('memoryProcess', e.target.value) }),
                h('input', { value: settings?.memoryPid || '', placeholder: 'PID（可选）', onChange: (e) => update('memoryPid', e.target.value) }),
              ) : null,
              settings?.memorySource === 'process' ? h(Row, { label: '模块与地址', hint: '地址优先；否则模块基址 + 偏移' },
                h('input', { value: settings?.memoryModule || '', placeholder: '模块名（可选）', onChange: (e) => update('memoryModule', e.target.value) }),
                h('input', { value: settings?.memoryAddress || '', placeholder: '绝对地址 0x...', onChange: (e) => update('memoryAddress', e.target.value) }),
                h('input', { value: settings?.memoryOffset || '', placeholder: '偏移 0x...', onChange: (e) => update('memoryOffset', e.target.value) }),
                h('input', { value: settings?.memoryPointerOffsets || '', placeholder: '指针偏移 0x10,0x20', onChange: (e) => update('memoryPointerOffsets', e.target.value) }),
                h('select', { value: settings?.memoryType || 'int32', onChange: (e) => update('memoryType', e.target.value) },
                  h('option', { value: 'int32' }, 'int32'),
                  h('option', { value: 'uint32' }, 'uint32'),
                  h('option', { value: 'int64' }, 'int64'),
                  h('option', { value: 'float' }, 'float'),
                  h('option', { value: 'double' }, 'double'),
                ),
              ) : null,
            ),
            section('语音与悬浮字幕',
              h(Row, { label: '语音回路' },
                h(Check, { checked: settings?.voiceEnabled, onChange: (v) => update('voiceEnabled', v) }, '启用按住说话 + TTS'),
              ),
              h(Row, { label: '按住说话键' },
                h('input', { value: settings?.pttKey || 'F8', onChange: (e) => update('pttKey', e.target.value) }),
              ),
              h(Row, { label: '麦克风设备', hint: 'ffmpeg dshow 名称，例如 “麦克风 (Realtek)”' },
                h('input', { value: settings?.micDevice || '', onChange: (e) => update('micDevice', e.target.value) }),
              ),
              h(Row, { label: 'TTS' },
                h('select', { value: settings?.ttsProvider || 'sapi', onChange: (e) => update('ttsProvider', e.target.value) },
                  h('option', { value: 'sapi' }, 'Windows SAPI'),
                  h('option', { value: 'dsh' }, 'DSH Speech（不可用回退）'),
                ),
              ),
              h(Row, { label: '悬浮字幕' },
                h(Check, { checked: settings?.overlayEnabled, onChange: (v) => update('overlayEnabled', v) }, '显示置顶字幕'),
              ),
            ),
            h('div', { className: 'fg-save' },
              h('button', { className: 'fg-btn is-primary', onClick: save, disabled: !settings }, '保存设置'),
              h('span', null, '设置写入 ~/.dsh/foxy-game/settings.json'),
            ),
          ),
          h('div', { className: 'fg-column' },
            h('div', { className: 'fg-card' },
              h('div', { className: 'fg-card-head' }, h('h2', null, '画面预览'), h('small', null, image ? '最近一次截图' : '点“截一张”')),
              image ? h('img', { className: 'fg-image', src: image, alt: 'game capture' }) : h('div', { className: 'fg-placeholder' }, '还没有截图'),
              last ? h('div', { className: 'fg-last' },
                h('b', null, last.action?.type || 'none'),
                h('span', null, last.analysis || ''),
                last.say ? h('em', null, `“${last.say}”`) : null,
              ) : null,
            ),
            h('div', { className: 'fg-card' },
              h('div', { className: 'fg-card-head' }, h('h2', null, '实时日志'), h('small', null, `${status.logs?.length || 0} 条`)),
              h('div', { className: 'fg-logs' },
                (status.logs || []).slice().reverse().map((entry, index) => h('div', { className: `fg-log is-${entry.kind}`, key: `${entry.at}-${index}` },
                  h('time', null, new Date(entry.at).toLocaleTimeString()),
                  h('span', null, entry.text),
                  entry.action ? h('code', null, JSON.stringify(entry.action)) : null,
                )),
                !status.logs?.length ? h('div', { className: 'fg-placeholder' }, '暂无日志') : null,
              ),
            ),
            h('div', { className: 'fg-card' },
              h('div', { className: 'fg-card-head' }, h('h2', null, '已知限制'), h('small', null, 'v0.1.9 预览')),
              h('ul', { className: 'fg-list' },
                h('li', null, '部分 DirectX 游戏 PrintWindow 黑屏，需要后续接 Windows.Graphics.Capture。'),
                h('li', null, '变化区域目前是整图哈希，尚未做块级 diff。'),
                h('li', null, '内存读取仅有自测 HTTP 源，不内置真实游戏偏移。'),
                h('li', null, '语音和悬浮窗需要在真实桌面会话验证；默认关闭。'),
              ),
            ),
          ),
        ),
      )
    }

    function section(title, ...children) {
      return h('div', { className: 'fg-section' },
        h('h2', null, title),
        h('div', { className: 'fg-rows' }, ...children),
      )
    }

    const CSS = `
.fg-page { --bg:var(--dsw-alias-bg-layer-1,#fff); --soft:var(--dsw-alias-bg-layer-2,#f6f6f4); --text:var(--dsw-alias-label-primary,#1f1e1d); --muted:var(--dsw-alias-label-secondary,#6f6d68); --line:var(--dsw-alias-border-l3,#e6e3dc); --accent:var(--dsw-alias-brand-primary,#d97757); box-sizing:border-box; height:100%; overflow:auto; padding:28px 32px 48px; background:var(--bg); color:var(--text); font:14px/1.55 var(--dsh-font-family-content,system-ui,"Microsoft YaHei",sans-serif); }
.fg-page * { box-sizing:border-box; } .fg-page > * { max-width:1180px; margin-left:auto; margin-right:auto; }
.fg-header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; padding-bottom:18px; border-bottom:1px solid var(--line); }
.fg-kicker { color:var(--muted); font-size:10px; letter-spacing:.14em; margin-bottom:6px; }
.fg-header h1 { margin:0 0 4px; font-size:24px; letter-spacing:-.02em; line-height:1.2; }
.fg-header p { margin:0; color:var(--muted); font-size:13px; }
.fg-actions { display:flex; align-items:center; gap:10px; }
.fg-state { color:var(--muted); font-size:12px; } .fg-state::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:6px; background:#b8b4aa; vertical-align:1px; }
.fg-state.is-live::before { background:#3f9b68; } .fg-state.is-bad::before { background:#c74a45; }
.fg-btn { padding:7px 12px; border:1px solid var(--line); border-radius:7px; background:var(--bg); color:var(--text); font:inherit; font-size:12px; cursor:pointer; }
.fg-btn:hover { background:var(--soft); } .fg-btn:disabled { opacity:.5; cursor:default; }
.fg-btn.is-primary { background:var(--text); color:var(--bg); border-color:var(--text); }
.fg-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:18px; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.fg-summary > div { padding:11px 14px; border-right:1px solid var(--line); min-width:0; } .fg-summary > div:last-child { border-right:0; }
.fg-summary span,.fg-summary small { display:block; color:var(--muted); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fg-summary strong { display:block; margin:3px 0 2px; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fg-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:18px 0; border-bottom:1px solid var(--line); }
.fg-message { color:var(--muted); font-size:12px; margin-left:4px; }
.fg-grid { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(340px,.8fr); gap:22px; align-items:start; }
.fg-column { display:flex; flex-direction:column; gap:18px; min-width:0; }
.fg-section { border:1px solid var(--line); border-radius:9px; padding:16px 18px 10px; background:var(--bg); }
.fg-section h2,.fg-card h2 { margin:0 0 10px; font-size:14px; }
.fg-rows { display:flex; flex-direction:column; }
.fg-row { display:grid; grid-template-columns:150px minmax(0,1fr); gap:14px; align-items:start; padding:9px 0; border-top:1px solid color-mix(in srgb,var(--line) 65%,transparent); }
.fg-row:first-child { border-top:0; } .fg-label { padding-top:5px; } .fg-label span { display:block; font-size:12px; } .fg-label small { display:block; margin-top:2px; color:var(--muted); font-size:11px; line-height:1.45; }
.fg-control { display:flex; flex-direction:column; gap:6px; min-width:0; }
.fg-control input:not([type=checkbox]),.fg-control select,.fg-control textarea { width:100%; padding:7px 9px; border:1px solid var(--line); border-radius:7px; background:var(--bg); color:var(--text); font:inherit; font-size:12px; }
.fg-control textarea { resize:vertical; } .fg-control input:focus,.fg-control select:focus,.fg-control textarea:focus { outline:2px solid color-mix(in srgb,var(--accent) 28%,transparent); border-color:var(--accent); }
.fg-check { display:inline-flex; align-items:center; gap:8px; padding-top:5px; font-size:12px; cursor:pointer; } .fg-check input { width:14px; height:14px; accent-color:var(--accent); }
.fg-save { display:flex; align-items:center; gap:12px; padding:16px 0 0; } .fg-save span { color:var(--muted); font-size:11px; }
.fg-card { border:1px solid var(--line); border-radius:9px; padding:14px; background:var(--bg); }
.fg-card-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; } .fg-card-head small { color:var(--muted); font-size:11px; }
.fg-image { width:100%; margin-top:10px; border-radius:7px; border:1px solid var(--line); display:block; }
.fg-placeholder { margin-top:10px; padding:24px 12px; border:1px dashed var(--line); border-radius:7px; color:var(--muted); text-align:center; font-size:12px; }
.fg-last { margin-top:10px; padding:10px; border-radius:7px; background:var(--soft); display:flex; flex-direction:column; gap:3px; font-size:12px; }
.fg-last b { font-size:11px; color:var(--accent); } .fg-last em { color:var(--muted); }
.fg-logs { display:flex; flex-direction:column; gap:2px; max-height:420px; overflow:auto; margin-top:8px; }
.fg-log { display:grid; grid-template-columns:64px minmax(0,1fr); gap:8px; padding:6px 2px; border-bottom:1px solid color-mix(in srgb,var(--line) 50%,transparent); font-size:11px; }
.fg-log time { color:var(--muted); font-variant-numeric:tabular-nums; } .fg-log span { min-width:0; overflow-wrap:anywhere; } .fg-log code { grid-column:2; color:var(--muted); font-size:10px; overflow-wrap:anywhere; }
.fg-log.is-error span { color:#b64a43; } .fg-log.is-say span { color:#3f8f67; } .fg-log.is-voice span { color:#8a6a2f; }
.fg-list { margin:4px 0 0; padding-left:17px; color:var(--muted); font-size:12px; line-height:1.7; }
.fg-error { margin-top:12px; padding:10px 12px; border:1px solid color-mix(in srgb,#c74a45 40%,var(--line)); border-radius:7px; color:#a33; background:color-mix(in srgb,#c74a45 6%,var(--bg)); font-size:12px; }
@media(max-width:900px){.fg-page{padding:20px 16px 32px}.fg-grid{grid-template-columns:1fr}.fg-summary{grid-template-columns:1fr}.fg-summary>div{border-right:0;border-bottom:1px solid var(--line)}.fg-summary>div:last-child{border-bottom:0}.fg-row{grid-template-columns:1fr;gap:4px}}
`

    const name = 'dsh-foxy-game'
    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ workbench: true }) }, GamePage),
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 18, label: () => 'Foxy Game' }, GameIcon),
      )
    }
    exports.name = name
    exports.inject = inject
    exports.apply = apply
    exports.PANEL_ID = PANEL_ID
    return module.exports
  },
})
