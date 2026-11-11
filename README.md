# dsh-foxy-game

让 Foxy 陪你玩游戏。不是“让模型看一张截图然后祈祷它能操作”，而是把**感知、决策、操作、交流**拆成可替换的适配器，先跑通一个可控的小闭环，再逐个游戏加适配。

> 当前是 `0.1.3` 开发预览版。默认关闭所有自动操作；不会主动碰带反作弊的网游。

### 开发进度（2026-11-12 04:02）

- 已跑通 DSH 侧栏、窗口枚举、窗口截图、SHA-256 跳帧、视觉模型 JSON 决策、后台动作接口、自测游戏 HTTP 闭环。
- `npm test`：11/11 通过（设置/脱敏/裁剪参数/键位/视觉解析/策略/自测游戏/memory/插件路由）。
- 真实 DSH `foxy-test` profile：侧栏 `Foxy Game` 已出现，`/api/dsh-foxy-game/status` 返回 200。
- 真实窗口截图：`captureWindow` 对系统设置窗口返回 640×379 JPEG（约 15 KB）；mock 视觉接口收到图片并返回决策。
- 自测游戏 memory 闭环：观察 → BFS 决策 → HTTP 动作 → 状态更新，已验证。
- 自动循环：能启动、按截图间隔跳帧、停止；画面未变化时只记 `skip` 日志。
- `F12` 全局紧急停止：已实测能写入停止标志并让循环停下；启动时自动拉起隐藏热键进程，停止时清理。
- 语音录音停止改为给 ffmpeg 发 `q` 正常收尾，避免直接 kill 留下损坏 WAV；真实麦克风录音仍待验证。
- 后台输入：`SendMessage` 对原生 WinForms 测试窗实测成功（`D` 使玩家 x+1），且不抢前台；Edge 会忽略合成消息，真实游戏兼容性必须逐个测。

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

当前版本实现了 `screen` 和 `hybrid` 的骨架；`memory` 目前只有受控的 HTTP 状态源（给自测游戏），**没有**真实游戏进程的内存读取偏移或写入能力。

## 已实现（开发预览）

- DSH 侧栏 `Foxy Game`：窗口选择、截图间隔、跳帧、视觉模型配置、动作模式、自动循环开关、实时日志。
- `capture.ps1`：枚举窗口，`PrintWindow`/屏幕回退截图，缩放 + JPEG，返回 base64；Node 侧做 SHA-256 跳帧。
- 安全：自动循环运行时可用 `F12` 全局紧急停止；默认 `enabled:false`，不会自行启动。
- `vision.js`：OpenAI 兼容的视觉请求，严格 JSON 输出（`analysis/action/say/confidence`）；解析失败会保留原文并报错。
- `actions.js` + `input.ps1`：键盘按下/抬起/点按、鼠标移动/点击、文本；支持 `background`（SendMessage）和 `foreground`（SendInput）。
- `test-game/`：一个本地小游戏 + HTTP 状态/动作 API，用来在没有视觉模型时验证“观测→决策→动作→记忆”闭环。
- 语音/悬浮字幕：`voice.js`、`overlay.ps1`、`hotkey.ps1` 的本地回路骨架（默认关闭，需要麦克风设备名）。
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
  "memorySource": "none",        // none | test-http
  "memoryUrl": "http://127.0.0.1:8787",
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

- [ ] 真实游戏窗口的 `PrintWindow` 在部分 DirectX 游戏返回黑屏；需要 `Windows.Graphics.Capture` 或 `ffmpeg gdigrab` 回退。
- [ ] 后台合成消息在 Edge 窗口实测无效（浏览器忽略）；原生 WinForms 测试窗用 `SendMessage` 已通过。真实游戏是否接受需逐个验证，不接受时只能回退前台 `SendInput` 或做 `AnchoredTouch`。
- [ ] 变化区域目前只做整图哈希；块级 diff / 只发变化区域还没做。
- [ ] 视觉模型的动作坐标是归一化坐标，未做窗口 DPI 校正；高 DPI 需要实测。
- [ ] 内存适配器目前只有自测 HTTP 源，**没有**真实进程内存读取或写入。
- [ ] 语音热键/悬浮窗需要在真实 Windows 会话中验证；当前默认关闭。
- [x] 自动循环支持 `F12` 全局紧急停止（`scripts/stop-hotkey.ps1`）；默认仍不自动启动。
- [ ] 没有做反作弊检测/规避；这是有意为之，不提供绕过能力。

## License

MIT
