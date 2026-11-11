# dsh-foxy-game

让 Foxy 陪你玩游戏。不是“让模型看一张截图然后祈祷它能操作”，而是把**感知、决策、操作、交流**拆成可替换的适配器，先跑通一个可控的小闭环，再逐个游戏加适配。

> 当前是 `0.1.27` 开发预览版。默认关闭所有自动操作；不会主动碰带反作弊的网游。

### 开发进度（2026-11-12 05:45）

- 已跑通 DSH 侧栏、窗口枚举、窗口截图、SHA-256 跳帧、视觉模型 JSON 决策、后台动作接口、自测游戏 HTTP 闭环。
- 变化区域裁剪（实验，默认关闭）：ffmpeg 对比上一帧，只把变化块送视觉模型；原生测试窗实测 440×300（5.4 KB）→ 112×104（1.5 KB），鼠标坐标会按裁剪区域自动映射回整窗。
- 浏览器/Edge 游戏截图已验证：对 Edge 里的 7×7 测试游戏 `PrintWindow` 得到 900×548 JPEG（约 27.8 KB），画面内容完整，不是黑屏。
- 浏览器游戏代理动作已验证：截图 → mock 视觉返回 `D` → 通过自测游戏 HTTP 桥执行，玩家从 (0,0) 走到 (1,0)；说明“浏览器画面 + 外部状态/动作桥”是可行的，绕开了 Edge 忽略后台键鼠消息的问题。
- 混合感知已验证：Edge 小花园截图 + 自测游戏 HTTP 状态一起送视觉模型，prompt 同时包含 900×726 JPEG 与 `grid/player/steps` 结构化状态；模型返回 `D` 后玩家从 (0,0) 走到 (1,0)。
- `npm test`：19/19 通过（设置/脱敏/裁剪参数/键位/视觉解析/策略/自测游戏/memory/插件路由/坐标映射/人设/对话/静音门限/麦克风解析/显式清空 Key/内存写入默认拦截）。
- 真实 DSH `foxy-test` profile：侧栏 `Foxy Game` 已出现，`/api/dsh-foxy-game/status` 返回 200。
- 真实窗口截图：`captureWindow` 对系统设置窗口返回 640×379 JPEG（约 15 KB）；mock 视觉接口收到图片并返回决策。`0.1.12` 起可选 `auto`/`printwindow`/`screen`：`auto` 在 PrintWindow 返回全黑时自动改用屏幕区域，系统设置窗口实测 `printwindow` 14,981 B、`screen` 14,333 B；全黑测试窗 `auto` 正确回退到 `screen`。
- 自测游戏 memory 闭环：观察 → BFS 决策 → HTTP 动作 → 状态更新，已验证。
- 进程内存（实验）：`scripts/memory.ps1` 支持按 PID/进程名、模块基址+偏移或绝对地址读取 `int32/uint32/int64/float/double`，并支持逗号分隔的指针链偏移；用测试进程验证“基址→指针→+0x10”读到 `424242`。写入默认关闭，必须手动勾选 `memoryWriteEnabled` 并点“写入”，只写当前地址；已在测试进程验证 `424242 → 777`，再读回 `777`，没有自动扫描或反作弊绕过。按进程名匹配到多个 PID 时现在会直接报错并列出 PID，避免误写同名进程。写入是“直接改当前地址”，如果把指针本身写坏，游戏会崩溃；务必先读确认地址和类型，再手动写入。
- 悬浮字幕可独立于语音运行：即使 `voiceEnabled:false`，只要 `overlayEnabled:true`，视觉模型的 `say` 也会显示在置顶字幕里，不强制开麦。已实测 overlay 进程启动、无热键进程。
- 自动循环：能启动、按截图间隔跳帧、停止；画面未变化时只记 `skip` 日志。
- `F12` 全局紧急停止：已用 `keybd_event` 注入 F12 实测，能写入停止标志；启动时自动拉起隐藏热键进程，停止时清理。
- 语音录音停止改为给 ffmpeg 发 `q` 正常收尾，避免直接 kill 留下损坏 WAV；真实麦克风录音仍待验证。
- 麦克风设备改为从 `ffmpeg -list_devices` 枚举，UI 下拉选择；本机实测列出 UGREEN、Steam Streaming、VoiceMeeter、AMD 阵列、MEGATRON 五个音频输入，避免手填 dshow 名称。
- 角色预设接入：UI 可从 `~/.dsh/foxy/presets` 选择 `personaPresetId`，视觉决策与按住说话的回复都会读取该 YAML 的 `persona` 块；实际读取 `foxy3` 得到 3,966 字人设，视觉提示仍以“只输出 JSON”收尾。
- 语音对话上下文：按住说话的回复会带上当前游戏窗口标题、上一轮画面分析、最近 8 轮对话，避免 Foxy 每句话都从零开始；回复仍限制两句话并走字幕/TTS。
- PTT 静音门限：录音结束后先用 ffmpeg `volumedetect` 测平均音量，低于 `pttMinVolumeDb`（默认 -45 dB）直接丢弃，避免把环境噪声转成“嗯”。用 1 秒虚拟麦克风录音（31,662 B，-91 dB）和 SAPI 语音 WAV（-26.3 dB）验证了门限两侧。
- PTT 空录音保护：注入 F8 短暂按下 120 ms 时 ffmpeg 会留下 0 字节 WAV；现在录制时长 <250 ms 或文件 <1 KB 直接跳过，不再把 EOFError 抛到 STT。实测 120 ms 快速按一下不报错、不转写；按住 1.5 秒虚拟静音被 -91 dB 门限丢弃。
- 文字对 Foxy 说：新增 `POST /api/dsh-foxy-game/say`，走与 PTT 相同的 `onVoiceTranscript` 流程（人设、当前窗口、上一轮画面、最近对话），并新增 `ttsProvider:'none'`（仅字幕）。用 mock LLM 实测返回「我在，先往右走，别撞墙。」，日志同时出现 voice/say 两条，且没有触发 SAPI。
- 语音独立启动：以前只有开始自动循环才启动 F8/字幕；现在保存设置时只要 `voiceEnabled` 或 `overlayEnabled` 为真就会启动，插件加载时也会恢复。实测 `running:false`、`voiceEnabled:true` 时 `voice.running:true`，不必先开自动操作。`overlayEnabled` 默认改为 false。测试 19/19。
- 文字对 Foxy 说 UI：在“语音与悬浮字幕”里直接输入文字发送，回复显示在输入框下方，同时写入实时日志。无 API Key 时会返回“我听到了：…”，用于验证上下文/UI 链路；实际模型回复需要填视觉 API Key。
- 游戏插件自己的 STT 链路已用 16 kHz 单声道 WAV 验证：`GameVoice.transcribe()` → `scripts/stt.py` → SenseVoice 输出 `你好，我是foxy。今天我们一起打游戏吧。`。这不是麦克风实录，PTT 录音仍需真实按键验证。
- 后台输入：`SendMessage` 对原生 WinForms 测试窗实测成功（`D` 使玩家 x+1），且不抢前台；后台鼠标也实测成功：`0.5,0.5` 点击被窗口记录为 `click:212,130`、`clicks:1`。Edge 会忽略合成消息，真实游戏兼容性必须逐个测。
- 完整屏幕闭环：原生 WinForms 测试窗 `hwnd 122882056` 截图 640×436（8.5 KB）→ mock 视觉返回 `{type:'key',key:'d'}` → 后台 `SendMessage`，玩家 x 从 0 变为 1，前台未切换。
- TTS 真实调用：`GameVoice.speak('测试语音。', { ttsProvider: 'sapi', overlayEnabled: false })` 返回 `{ok:true,provider:'sapi'}`，耗时约 2.5 秒；这是 SAPI 播放路径，不是虚拟麦克风。

## 设计原则

1. **先适配，再通用**：屏幕、内存、游戏 API 都只是“观测源”；键鼠、后台消息、内存写入都只是“动作端”。
2. **默认低成本**：截图先做窗口裁剪、缩放、JPEG 压缩，再按哈希跳帧；不是每帧都发给视觉模型。
3. **默认不抢前台**：优先后台 `SendMessage`（同步调用，可能被不处理消息的游戏卡住），前台 `SendInput` 作为兼容回退；MAA 的 `AnchoredTouch` 说明“合成输入不移动真实光标”是可行的，但需要游戏窗口支持。
4. **语音是本地回路**：按住快捷键说话 → 本地 STT → 模型 → 悬浮字幕 + TTS；不依赖游戏内聊天框。
5. **危险能力显式开启**：读内存、写内存、自动点击都默认关闭，并在 UI 里单独警告。

## 三条感知路线

| 模式 | 原理 | 适合 | 风险/限制 |
| --- | --- | --- | --- |
| `screen` | 窗口截图 → 视觉模型 → 动作 | 解密、视觉小说、回合制、慢节奏策略 | 延迟高、token 贵、精确坐标难 |
| `memory` | 读游戏进程/游戏 API 的结构化状态 | 本地小游戏、模拟器、带 API 的游戏 | 需要偏移/结构；反作弊风险；版本一变就坏 |
| `hybrid` | 内存给数值，屏幕给空间/文字 | 大多数可组合场景 | 两套适配器都要维护 |

当前版本实现了 `screen`、`hybrid` 和 `memory` 的骨架；`memory` 支持受控 HTTP 状态源（自测游戏）和进程内存（PID/进程名 + 模块偏移/绝对地址 + 数值类型 + 指针链）。读取默认可用；写入必须手动打开 `memoryWriteEnabled`，只写当前地址，**没有**自动偏移扫描或反作弊绕过。

## 已实现（开发预览）

- DSH 侧栏 `Foxy Game`：窗口选择、截图间隔、跳帧、视觉模型配置、动作模式、自动循环开关、实时日志。
- `capture.ps1`：枚举窗口，`PrintWindow`/屏幕回退截图，缩放 + JPEG，返回 base64；Node 侧做 SHA-256 跳帧。
- 安全：自动循环运行时可用 `F12` 全局紧急停止；默认 `enabled:false`，不会自行启动。
- `vision.js`：OpenAI 兼容的视觉请求，严格 JSON 输出（`analysis/action/say/confidence`）；解析失败会保留原文并报错。
- `actions.js` + `input.ps1`：键盘按下/抬起/点按、鼠标移动/点击、文本；支持 `background`（SendMessage）和 `foreground`（SendInput）。
- `test-game/`：一个本地小游戏 + HTTP 状态/动作 API，用来在没有视觉模型时验证“观测→决策→动作→记忆”闭环。
- 语音/悬浮字幕：`voice.js`、`overlay.ps1`、`hotkey.ps1` 的本地回路骨架（默认关闭，需要麦克风设备名）。悬浮字幕已实测：原生长文本会自动扩高到 760×208，并保持置顶。
- `scripts/stt.py`：本地 SenseVoice 转写后备；TTS 优先 DSH Speech，回退 Windows SAPI。

## 调研结论

- **Neuro-sama** 不是纯屏幕 AI：游戏通过 [Neuro API](https://github.com/o9nn/neuro-sama) 这类游戏侧 SDK 暴露状态/动作，AI 与语音是独立管线。结论：能给游戏加 API 时，API 永远优于截图。
- **ARC-AGI 多模态 Agent** 常用“每步截图 → 视觉模型分析 → 动作 → 累计规则/历史”，但会把图缩到很小（如 128×128）来控制成本。结论：全量每帧视觉不可持续，必须跳帧 + 变化检测 + 结构化缓存。
- **MAA Win32** 的输入分层：`Seize`（SendInput，兼容性最好但抢鼠标）、`Message/Post`（后台消息，部分游戏屏蔽）、`AnchoredTouch`（`InjectSyntheticPointerInput`，不移动真实光标/不切前台，MaaFramework v5.13.0）。参考 [MAA Win32 控制器](https://deepwiki.com/MaaXYZ/MaaFramework/4.2-win32)、[MAA PR #18341](https://github.com/MaaAssistantArknights/MaaAssistantArknights/pull/18341)。结论：默认后台，失败再回退前台；不要默认抢鼠标。
- **LLM 游戏 Agent** 的共同点是“观察→行动→结果→短期记忆”的循环，而不是一次性长提示。参考 [Human Strategy Meets AI Execution](https://dl.acm.org/doi/pdf/10.1145/3715014.3724375)。

## 快速开始

```powershell
# 在 DSH 工作区
cd D:\Documents\deepseek-harness\default-workspace\dsh-foxy-game
npm test

# 启动自测游戏（另一个终端）
npm run test-game
# 浏览器打开 http://127.0.0.1:8787

# 或者启动原生 WinForms 测试窗，专门测后台输入
powershell -ExecutionPolicy Bypass -File test-game/win.ps1
# 状态文件：%TEMP%\foxy-win-game.json
```

安装到 DSH（开发时）：

```powershell
dsh plugin --profile desktop add file:D:\Documents\deepseek-harness\default-workspace\dsh-foxy-game
```

然后在侧栏打开 `Foxy Game`：

1. 点“刷新窗口”，选择游戏窗口；
2. 配置视觉模型（OpenAI 兼容 `/chat/completions`，模型必须支持图片输入）；
3. 先点“观察一次”，看日志里的分析/动作；
4. 确认动作模式（建议先 `background`）再开“自动循环”。

## 配置

设置保存在 `~/.dsh/foxy-game/settings.json`。关键字段：

```jsonc
{
  "enabled": false,
  "mode": "screen",              // screen | hybrid | memory
  "windowHwnd": 0,
  "windowTitle": "",
  "captureIntervalMs": 1500,
  "skipUnchanged": true,
  "maxWidth": 1280,
  "jpegQuality": 65,
  "visionBaseUrl": "https://api.deepseek.com",
  "visionApiKey": "",
  "visionModel": "deepseek-chat",
  "actionMode": "background",    // background | foreground | none
  "autoPlay": false,
  "maxStepsPerMinute": 20,
  "memorySource": "none",        // none | test-http | process
  "memoryUrl": "http://127.0.0.1:8787",
  "memoryProcess": "",
  "memoryPid": 0,
  "memoryModule": "",
  "memoryAddress": "",
  "memoryOffset": "",
  "memoryPointerOffsets": "",   // 逗号分隔，如 0x10,0x20
  "memoryType": "int32",         // int32 | uint32 | int64 | float | double
  "voiceEnabled": false,
  "pttKey": "F8",
  "micDevice": "",
  "ttsProvider": "sapi",         // sapi | dsh
  "overlayEnabled": true
}
```

## 目录

```
lib/            DSH 服务端插件、截图、视觉、动作、语音
scripts/        PowerShell 窗口/截图/输入/悬浮窗/热键，Python STT
test-game/      本地自测游戏 + HTTP API
test/           Node 内置测试
```

## 已知问题 / 下一步

- [ ] 真实游戏窗口的 `PrintWindow` 在部分 DirectX 游戏返回黑屏；`captureMethod:'screen'` 已能按窗口矩形截桌面，适合无边框/窗口化 DirectX，但独占全屏仍需要 `Windows.Graphics.Capture` 或 `ffmpeg gdigrab`。Edge/Chromium 内容实测可截，但不是所有 GPU 加速窗口都行。
- [ ] 后台合成消息在 Edge 窗口实测无效（浏览器忽略）；原生 WinForms 测试窗用 `SendMessage` 已通过。真实游戏是否接受需逐个验证，不接受时只能回退前台 `SendInput` 或做 `AnchoredTouch`。
- [x] 变化区域裁剪（实验，默认关闭）：ffmpeg diff 找 bbox，裁剪后只送变化块；鼠标坐标自动映射回整窗。只裁剪会丢失画面上下文，复杂游戏建议关闭或配合完整帧使用。
- [ ] 视觉模型的动作坐标是归一化坐标，未做窗口 DPI 校正；高 DPI 需要实测。
- [ ] 内存适配器目前支持单值读取（绝对地址或模块基址+偏移，可带指针链）；写入需手动开启并填值，没有结构体/数组读取、自动扫描或反作弊绕过。
- [x] 悬浮字幕已单独验证；按住说话热键已用 `keybd_event` 注入 F8 验证（按下写入 `ptt.down`、松开删除）。
- [x] Windows SAPI 播报已用 `speak.ps1` 实测退出码 0。
- [ ] 麦克风录音/STT 还需要真实麦克风端到端验证，当前默认关闭。
- [x] 自动循环支持 `F12` 全局紧急停止（`scripts/stop-hotkey.ps1`）；默认仍不自动启动。
- [ ] 没有做反作弊检测/规避；这是有意为之，不提供绕过能力。

## License

MIT


