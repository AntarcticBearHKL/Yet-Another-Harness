# miniharness-electron

`D:\Dev\Harness\miniharness` 的 Electron 重写版。保留原来的核心体验：

- 无边框、半透明/玻璃质感的桌面窗口，单一暖色浅色主题（奶油底 + 琥珀/陶土强调），没有深浅切换
- DeepSeek V4.1 Flash 流式对话（通过 OpenCode Go 的 OpenAI 兼容端点）
- tool calling loop（模型 → 工具 → 模型）
- 免费 `web_search`（DuckDuckGo HTML，不需要 API key）
- 所有对话卡片同宽，占满窗口宽度，只留很窄的左右边距
- 没有标题栏：窗口控制按钮浮动在右上角，按住任意非交互区域都能拖动窗口
- 没有聊天顶栏：会话内容铺满窗口，输入框悬浮在底部
- 没有侧边栏；按 Tab 打开全屏对话切换界面，支持键盘选择、删除、新建和打开设置
- 浮动面板（输入框、设置、全屏切换界面、窗口按钮）统一使用半透明磨砂玻璃质感
- 聊天内容接近窗口上下边缘时渐进模糊、淡出，不会生硬地被边界切断
- 每条消息、工具调用和工具返回都是可折叠卡片，用颜色区分
- 工具调用的 JSON 参数和 JSON 输出用带语法着色、可折叠节点的查看器展示
- 双击任意对话卡片可以查看该轮实际发给模型的原始请求 body，完整 JSON 树可逐层折叠
- 所有区域隐藏滚动条，滚轮/触控板仍然可以滚动
- 会话、设置、API key 落盘；可以删光所有对话，空状态不会自动补一个新对话
- 全局禁用鼠标框选和右键菜单；只有输入框保留文本选择

旧的 Rust/Slint 版已经删除；新开发都在这个目录。

## 运行

```bash
npm install
npm start
```

桌面上有 `miniharness.lnk`，直接双击启动（指向 `node_modules\electron\dist\electron.exe`，
工作目录是本项目，图标是 `assets\miniharness.ico`）。移动项目目录后需要重新创建快捷方式。

测试：

```bash
npm test
LIVE_SEARCH=1 npm test   # 额外跑一条真实 DuckDuckGo 搜索
```

要求 Node.js 22+（Electron 45 自带 Chromium，不需要单独装浏览器）。

## 架构

```
src/main.js       BrowserWindow、IPC、窗口控制、chat:send
src/preload.js    contextBridge 暴露给渲染进程的 API
src/deepseek.js   OpenCode Go SSE + tool_calls 累积 + agent loop
src/tools.js      免费 web_search（DuckDuckGo HTML）
src/store.js      chats.json / settings.json 原子写 + 旧版迁移
src/renderer.js   聊天、全屏对话切换、设置浮层
src/index.html    页面骨架
src/styles.css    主题、气泡、浮层、输入区
```

渲染进程只负责画；网络请求、API key、工具执行都在主进程。`contextIsolation: true`，
`nodeIntegration: false`，页面 CSP 只允许本地脚本/样式。

## 模型

- 端点：`https://opencode.ai/inference/go/openai/v1/chat/completions`
- 模型：`deepseek-v4.1-flash`
- 鉴权：OpenCode Go 的 API key（Bearer）
- 请求带 `User-Agent: miniharness-electron/0.3.0`，并为每个会话带稳定的
  `x-opencode-session`，方便网关路由和 prompt cache

## 数据

- `%APPDATA%\miniharness-electron\chats.json`：所有对话数据
  - `sessions[]`：每个会话的 `id`、`title`、`system`、`msgs[]`
  - `msgs[]`：消息角色、文字、以及工具调用/返回的 `steps`
  - 每条助手消息的 `requests[]`：该轮 agent loop 实际发给模型的原始请求 body（双击卡片查看）
  - `current` / `seq`：当前选中的会话索引和标题序号
- `%APPDATA%\miniharness-electron\settings.json`：API key、窗口位置和尺寸

第一次启动时，如果新目录没有数据，会尝试从旧版 `%APPDATA%\miniharness` 迁移
`chats.json` 和 `settings.json`（`api_key` → `apiKey`，`window.w/h` → `width/height`）。

API key 和旧版一样是明文存在 `settings.json` 里；本地应用，没接 Windows Credential
Manager。这里存的是 OpenCode Go 的 key，不是 DeepSeek 官方 API key。

## 玻璃

Electron 版用 **不透明 acrylic + Windows 11 DWM 原生圆角**：

- `backgroundMaterial: 'acrylic'` 由系统做亚克力模糊；
- `roundedCorners: true` 让 DWM 直接裁圆角，页面不再画第二层圆角，也不再用
  `setShape`（那会导致缩放拖影和方角黑边）；
- 页面只叠一层固定的暖色 tint，没有透明度设置；
- 系统不支持 acrylic 时回退到深色背景，功能不受影响。

Windows 11 的活动窗口可能有一条 1px 的系统 accent 边框，这是 DWM 画的，不是应用背景。

## Tool calling

- 每次请求带 `tools: [web_search]` 和 `tool_choice: 'auto'`。
- 流式响应里的 `delta.tool_calls` 按 `index` 把 `function.arguments` 拼起来。
- 模型要工具时：把 assistant 的 tool_calls 放回 messages，顺序执行工具，追加
  `role: 'tool'` 结果，再请求模型；最多 **6 轮**。
- 工具执行期间在对话里依次插入 `TOOL CALL`（完整参数）和 `TOOL RESULT`（完整输出）气泡，正文继续流式输出。
- 工具调用和结果不落盘，只保存最终回复。

`web_search` 抓 `https://html.duckduckgo.com/html/?q=...`，解析 `result__a` /
`result__snippet`，把 `uddg=` 重定向解成真实 URL，去标签、解 HTML 实体。免费、无 key，
但 DuckDuckGo 可能限流/弹 CAPTCHA；这时返回 `tool error`，模型可以换个说法再搜。

## 和 Rust 版的差异

- 用 Chromium 渲染，字体/布局与 Slint 版略有差异。
- 背景是系统亚克力 + DWM 圆角，不再是桌面截图快照；因此没有“快照过期”的问题，
  模糊强度由系统 acrylic 决定，页面只叠一层固定的暖色 tint。
- 没有 `jsonview` / 点气泡看 raw request：界面上只显示对话本身。
- 仍然没有取消在途请求的按钮；一次只允许一个请求。

## 已知限制

- 只在 Windows 上实际验证；Electron 其他平台能启动，但没有 acrylic。
- DuckDuckGo 是抓公开 HTML，没有官方 SLA。
- 工具串行执行，没有并行；tool_calls 不落盘。
- 窗口位置/大小会保存；换了显示器后按工作区钳制。
