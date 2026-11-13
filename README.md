# YAH - Yet Another Harness

YAH 是 `D:\Dev\Harness\yah` 里的 Electron 聊天 harness，保留原来 miniharness 的核心体验：

- 无边框、扁平暖色桌面窗口，单一浅色主题（奶油底 + 琥珀/陶土强调），没有深浅切换
- DeepSeek V4.1 Flash 流式对话（通过 OpenCode Go 的 OpenAI 兼容端点）
- tool calling loop（模型 → 工具 → 模型）
- 免费 `web_search`（DuckDuckGo HTML，不需要 API key）
- 所有对话条目同宽，占满窗口宽度，只留很窄的左右边距
- 没有标题栏：窗口控制按钮浮动在右上角，按住任意非交互区域都能拖动窗口
- 没有聊天顶栏和底部输入框：会话内容占满整个窗口高度；按 Alt 打开/关闭居中的输入框
- Alt 输入框：透明毛玻璃高斯模糊遮罩；输入框外的区域按住左键仍可拖动窗口；Enter 发送，Shift+Enter 换行，Esc 或再次按 Alt 关闭；关闭时保留草稿，新对话会清空
- 没有侧边栏；按住 Tab 立即打开全屏对话切换界面，松开收起，支持键盘选择和删除
- 扁平化界面：没有卡片底色、阴影、圆角卡片和模糊面板，用分隔线、文字颜色和当前条目的暖色底高亮区分；唯一例外是 Alt 输入框的透明毛玻璃遮罩
- 聊天内容接近窗口上下边缘时渐进淡出，不会生硬地被边界切断
- 每条消息、工具调用和工具返回都是可折叠条目，用圆点和标题颜色区分；用户/助手标签显示为 `prompt` / `response`
- 思考过程单独显示为 `thinking` 条目，和最终 `response` 分开；回传按 pi 风格处理：同一 provider/api/model 时作为 assistant 消息的 `reasoning_content` 回传，不拼进 `content`，换模型时丢弃
- 正常情况下同一时间只展开一张条目：生成中自动跟随最新条目，非生成时默认最后一张；空格预览时只展开当前 hover 的条目，松开后恢复
- 当前展开的条目有暖色底高亮，带 8px 圆角；折叠条目 hover 高亮为直角；空格预览时鼠标指向的条目高亮更深，一眼能看出正在看哪一条
- 鼠标指向任意条目时按住空格可以临时展开，移动鼠标会切换目标，松开恢复自动状态；预览时只展开当前 hover 的条目，其他条目立即折叠，并补偿滚动位置，让标题始终停在鼠标下的屏幕位置，内容只向下展开；输入框打开时空格正常输入
- 展开条目时固定当前滚动位置，不会因为高度变化丢失阅读位置
- Ctrl + 滚轮按条目导航：收起当前条目，跳到上/下一条并把目标标题定位到顶部附近，目标立即展开；普通滚轮仍是连续滚动
- Shift + 滚轮只在用户 `prompt` 条目之间切换并立即展开；从任意条目开始，向下找下一条 prompt，向上找上一条 prompt
- 条目展开/折叠和 Tab 切换界面都有过渡动画；Tab 界面约 0.1s 淡入淡出
- Tab 切换界面是行列表而不是卡片，空白区域也可以按住左键拖动窗口
- 有弹窗（Tab 切换器、设置、raw 查看器）打开时，右键等于关闭弹窗
- 工具调用的 JSON 参数和 JSON 输出用带语法着色、可折叠节点的查看器展示
- 双击任意对话卡片可以查看该轮实际发给模型的原始请求 body，完整 JSON 树可逐层折叠
- 所有区域隐藏滚动条，滚轮/触控板仍然可以滚动
- 会话用 SQLite（`node:sqlite`，WAL）管理；设置和 API key 仍存 `settings.json`
- 全局禁用鼠标框选和右键菜单；只有输入框保留文本选择

旧的 Rust/Slint 版已经删除；新开发都在 `D:\Dev\Harness\yah`。

## 运行

```bash
npm install
npm start
```

桌面上有 `YAH - Yet Another Harness.lnk`，直接双击启动（指向 `node_modules\electron\dist\electron.exe`，
工作目录是本项目，图标是 `assets\yah.ico`）。移动项目目录后需要重新创建快捷方式。

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
src/store.js      chats.db（SQLite/WAL）+ settings.json 原子写 + 旧版迁移
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
- 请求带 `User-Agent: yah/0.3.0`，并为每个会话带稳定的
  `x-opencode-session`，方便网关路由和 prompt cache

## 数据

- `%APPDATA%\yah\chats.db`：所有对话数据（SQLite，WAL）
  - `sessions`：会话 id、标题、system、排序
  - `messages`：每个会话的消息角色和文字
  - `steps`：工具调用/返回、文本片段、轮次
  - `requests`：每条助手消息每轮的原始请求 body（gzip 压缩的 JSON BLOB）
  - `app_state`：当前会话 id 和标题序号
  - 运行时还会出现 `chats.db-wal` / `chats.db-shm`；备份时不要只复制 `chats.db`
- `%APPDATA%\yah\settings.json`：API key、窗口位置和尺寸

第一次启动时，如果新的 `yah` 数据目录不存在，会从旧的 Electron 目录
`%APPDATA%\miniharness-electron` 复制数据库和设置；如果数据库还没有会话，会尝试导入旧的 `chats.json`，成功后把原文件
重命名为 `chats.json.pre-sqlite` 作为备份；也会尝试从旧版 `%APPDATA%\miniharness`
迁移 `chats.json` 和 `settings.json`（`api_key` → `apiKey`，`window.w/h` → `width/height`）。

API key 和旧版一样是明文存在 `settings.json` 里；本地应用，没接 Windows Credential
Manager。这里存的是 OpenCode Go 的 key，不是 DeepSeek 官方 API key。

## 外观

页面是扁平化暖色主题：

- 整个窗口使用纯色奶油底，没有卡片底色、圆角卡片、阴影或 backdrop blur（Alt 输入框的透明毛玻璃遮罩除外）；
- 对话条目用细分隔线和文字/圆点颜色区分；
- 输入框、设置、raw 查看器和切换界面都是纯色平面面板；
- 窗口保留 Windows 11 DWM 原生圆角（`roundedCorners: true`），不再用 `setShape`；
- 系统不支持时只影响窗口材质，不影响布局和功能。

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
