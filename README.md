# YAH - Yet Another Harness

YAH 是 `D:\Dev\Harness\yah` 里的 Electron 聊天 harness，保留原来 miniharness 的核心体验：

- 无边框、扁平暖色桌面窗口，单一浅色主题（奶油底 + 琥珀/陶土强调），没有深浅切换
- DeepSeek V4.1 Flash 流式对话（通过 OpenCode Go 的 OpenAI 兼容端点）
- tool calling loop（模型 → 工具 → 模型）
- 免费 `web_search`（DuckDuckGo HTML，不需要 API key）
- 所有对话条目同宽，占满窗口宽度，只留很窄的左右边距
- 没有标题栏：窗口控制按钮浮动在右上角，按住任意非交互区域都能拖动窗口，拖动窗口边缘可缩放
- 禁用 Chromium 默认的中键拖拽/自动滚动，中键不会进入滚动模式
- 右上角最小化 / 最大化 / 关闭只在主对话界面显示；打开 Tab、工具、设置、raw、输入框或环形菜单时隐藏
- 没有聊天顶栏和底部输入框：会话内容占满整个窗口高度；按 Space 打开居中的输入框
- Space 输入框：透明毛玻璃高斯模糊遮罩；输入框为空时再按 Space 关闭；点击输入框外关闭，按住拖动则优先拖动窗口；Enter 发送，Shift+Enter 换行，Esc 关闭；关闭时保留草稿，新对话会清空
- 没有侧边栏；按住 Tab 立即打开全屏工作区，松开收起，支持键盘选择和删除
- 扁平化界面：没有阴影和模糊面板；用回合竖线、细竖线、文字层级和很淡的圆角暖色底区分，唯一例外是 Space 输入框的透明毛玻璃遮罩
- 全局使用 Resource Han Rounded CN（资源圆体，SIL OFL）：界面、对话正文、工具/JSON 查看器统一圆体
- 对话正文重新排版：回答 15.5px、过程 13px、1.8 行高、居中阅读列、统一段落间距；`一、二、三、` 这类章节标题自动加粗并着色
- 聊天内容接近窗口上下边缘时渐隐范围更宽、更明显，不会生硬地被边界切断
- 对话按回合分组：每个回合用左侧一条暖色竖线包住；用户 prompt 始终显示，回答是主内容，思考和工具作为次级过程
- 用户 prompt 直接作为回合开头，不再有左侧 `YOU` / `YAH` 角色列；回合之间 48px 间距
- 思考过程单独显示为 `思考` 条目，和最终 `回复` 分开；回传按 pi 风格处理：同一 provider/api/model 时作为 assistant 消息的 `reasoning_content` 回传，不拼进 `content`，换模型时丢弃
- 每个回合的最终回复标题旁显示 token 用量 `输入命中/输入未命中/输出`（如 `0/402/3`），数据随消息持久化到 SQLite
- 回答和过程条目的标题行及折叠预览可点击展开/折叠；按住并拖动超过 4px 则改为拖动窗口，松开后不会误触展开/折叠
- 展开一条时其他条目自动折叠；「过程」分组可以单独折叠/展开，默认展开；生成中自动跟随最新条目，非生成时默认展开最后一条回答
- 折叠时在标题行下方保留一行内容预览（取正文首行，超出省略），不展开也能看出大概内容；展开后预览收起
- 折叠条目透明，hover 出现圆角暖色底；展开的条目用整卡圆角暖色底，背景随内容一起展开，约 180ms 背景过渡 + 200ms 高度过渡
- 每个回合的思考、工具调用和过程文字收在一个可折叠的「过程」标签下，默认展开；过程条目与回复同缩进，过程文字更小更淡，当前展开的过程卡片只用更浅的暖色底
- 展开条目时固定当前滚动位置，不会因为高度变化丢失阅读位置；如果上方有折叠/展开的条目导致高度变化，会实时校正滚动位置，保持被展开条目的标题位置不变
- 展开正文默认最多 10 行，超出部分底部渐隐；双击正文或折叠预览查看全文（桌面端独立窗口，网页端全屏），流式内容会实时同步；Ctrl + 双击正文查看 raw request body
- 流式输出超过 10 行时，卡片自动跟随最后 10 行，顶部渐隐、最新一行保持清晰；输出结束后回到前 10 行
- 全文窗口同样可以按住左键在任意非交互区域拖动、拖动边缘缩放，右上角按钮、Esc 或右键关闭
- Ctrl + 滚轮按对话回合导航：跳到上/下一个回合，空间足够时把目标回合顶到可视区顶部，并让该回合标题短暂高亮闪烁；普通滚轮仍是连续滚动
- 条目展开/折叠和 Tab 切换界面都有过渡动画；Tab 界面约 0.1s 淡入淡出
- Tab 工作区是全屏左右分栏：左边项目、右边对话，没有顶部标题和底部提示，所有操作按钮只显示图标
- Tab 工作区保持极简：项目行只显示名称，对话行只显示标题；当前项目用左侧色条标记，当前对话用圆点标记
- Tab 工作区：项目行悬停立即切换项目；对话行悬停只高亮，松开 Tab 才选中并收起面板；项目列表末尾的 `+` 行点击新建项目，悬停项目后按空格新建对话；设置 / 删除按钮只响应点击
- 新对话还没有消息时，标题跟随输入框里的第一句；第一句发出后由 LLM 生成一个短标题
- Tab 工作区的对话行后续可以展开查看 subagent；现在暂不展开
- 项目、项目归属和对话一起持久化到 SQLite；工作区空白区域仍然可以按住左键拖动窗口
- 有弹窗（Tab 切换器、设置、raw 查看器）打开时，右键等于关闭弹窗
- 主界面按住右键弹出环形菜单：工具、Skill、MCP；把鼠标拖到对应扇区后松开右键打开对应信息界面
- 工具和 Skill 面板是无标题的左右分栏：工具页左侧按分类列出工具（搜索 / 文件 / 系统 / MCP / 代理等），右侧显示名称、说明、参数；MCP 是独立的全屏工作区，左侧服务器、右侧工具 / 资源 / 提示词 / 日志 / 概览；没有内容时显示空状态
- 所有空状态（无对话、无消息、无工具/Skill/MCP、raw 为空、全文为空）统一在可用区域居中，颜色比正文淡一档
- 工具调用的 JSON 参数和 JSON 输出用带语法着色、可折叠节点的查看器展示
- Ctrl + 双击任意对话卡片可以查看该轮实际发给模型的原始请求 body，完整 JSON 树可逐层折叠
- 所有区域隐藏滚动条，滚轮/触控板仍然可以滚动
- 后端服务用 SQLite（`node:sqlite`，WAL）管理会话；设置和 API key 存 `settings.json`，窗口位置存 `window.json`
- MCP 服务器分两类：OpenCode 配置里的服务器自动继承（只读），以及 YAH 自己的 `%APPDATA%\yah\mcp.json` 自定义服务器；支持 STDIO、Streamable HTTP、legacy SSE，支持表单添加和粘贴 `mcpServers` / `mcp.servers` JSON
- OpenCode 中启用的 MCP 启动时自动连接，所有工具对所有对话自动开放，没有 per-chat 开关；OpenCode 中禁用的服务器会显示但不会连接；工具名统一为 `mcp__<server>__<tool>`
- MCP 工作区左侧是服务器列表（顶部没有标题和数字，底部只有「添加服务器」），右侧可以查看 tools / resources / prompts / logs / overview，手动调用工具、读取资源、获取提示词，并把工具、结果、资源或提示词插入输入框；没有服务器时空状态在整个内容区上下居中
- 全局禁用鼠标框选和右键菜单；只有输入框保留文本选择

旧的 Rust/Slint 版已经删除；新开发都在 `D:\Dev\Harness\yah`。

## 运行

```bash
npm install
npm start
```

桌面上有 `YAH - Yet Another Harness.lnk`，直接双击启动（指向 `node_modules\electron\dist\electron.exe`，
工作目录是本项目，图标是 `assets\yah.ico`）。移动项目目录后需要重新创建快捷方式。

### 前后端分离 / 远程访问

桌面端会自动探测并连接本地后端；如果后端没运行，它会用 Electron 自带的 Node 拉起来。
需要内网穿透时，先手动启动后端，再开桌面端：

```bat
set YAH_REMOTE_PASSWORD=your-password
start-server.cmd
```

- `start-server.cmd` 启动本地后端：`127.0.0.1:3789` 给桌面端，`127.0.0.1:3790` 给远程入口。
- 远程入口使用 Basic Auth，用户名默认 `yah`，密码是 `YAH_REMOTE_PASSWORD`；没设置密码时远程入口不启动。
- 另开窗口运行 `start-tunnel.cmd`（需要把 `cloudflared.exe` 放在项目目录），把公网地址转发到 `127.0.0.1:3790`。
- 浏览器打开穿透地址即可使用同一个界面；桌面端的窗口按钮在网页里会隐藏。
- 停止后端：`stop-server.cmd`。
- 便携数据：在 `start-server.cmd` 里取消 `set YAH_DATA_DIR=%~dp0data` 的注释，数据会放在项目目录的 `data/`。

测试：

```bash
npm test
LIVE_SEARCH=1 npm test   # 额外跑一条真实 DuckDuckGo 搜索
```

要求 Node.js 22+（Electron 45 自带 Chromium，不需要单独装浏览器）。`start-server.cmd` 使用 Electron 自带的 Node，不需要另外安装 Node。

## 架构

```
server/index.js    本地后端：HTTP API、SSE、静态页面、远程 Basic Auth
server/runner.js   agent 主循环、工具执行、消息/事件持久化
server/mcp/config.js   MCP 自定义配置存储、JSON 配置解析
server/mcp/opencode.js OpenCode 配置发现与 MCP 服务器继承
server/mcp/transport.js STDIO / Streamable HTTP / legacy SSE 传输
server/mcp/client.js   MCP JSON-RPC 客户端、握手、能力缓存
server/mcp/manager.js  MCP 连接生命周期、自动重连、工具/资源/提示词调用
server/mcp/format.js   MCP 结果转纯文本
src/main.js        Electron 壳：窗口、拖动/缩放、全文窗口、拉起/连接后端
src/preload.js     只暴露窗口拖动/缩放和全文窗口能力
src/deepseek.js    OpenCode Go SSE + tool_calls 累积 + agent loop（后端）
src/tools.js       免费 web_search、read_file 和 MCP 工具路由（后端）
src/mcp-registry.js MCP 工具到 OpenAI function 的映射（后端）
src/store.js       chats.db（SQLite/WAL）+ settings.json 原子写 + 旧版迁移
src/renderer.js    网页客户端：聊天、项目工作区、设置、环形菜单、HTTP/SSE
src/mcp-ui.js      MCP 工作区：服务器、工具、资源、提示词、日志、概览
src/index.html     页面骨架
src/styles.css     主题、布局、浮层、输入区
src/resize.js      无边框窗口的边缘缩放手柄（桌面端）
src/resize.css     缩放手柄布局和光标
src/content.html   桌面端独立全文窗口页面
src/content.css    全文窗口排版和圆体
src/content.js     全文窗口渲染和流式更新
start-server.cmd   启动本地后端（可带远程入口）
stop-server.cmd    停止本地后端
start-tunnel.cmd   内网穿透示例（cloudflared）
```

桌面端和远程网页加载的是同一份 `src/index.html` + `renderer.js`；界面只负责显示和输入，
agent 循环、工具、SQLite、API key 都在本地后端。`contextIsolation: true`，
`nodeIntegration: false`，页面 CSP 只允许本地脚本/样式和同源 HTTP/SSE。

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
  - `runs`：一次 agent 执行的状态
  - `events`：按会话递增的事件日志，用于 SSE 断线重连补发
  - `app_state`：当前会话 id 和标题序号
  - 运行时还会出现 `chats.db-wal` / `chats.db-shm`；备份时不要只复制 `chats.db`
- `%APPDATA%\yah\settings.json`：API key（后端读取，网页端拿不到）
- `%APPDATA%\yah\mcp.json`：YAH 自己添加的 MCP 服务器配置（STDIO 命令/参数/环境变量，或远程 URL/Headers）
- OpenCode 的 `opencode.json(c)`：MCP 服务器会自动继承，不在 YAH 的 `mcp.json` 里复制
- `%APPDATA%\yah\window.json`：桌面窗口位置和尺寸
- `%APPDATA%\yah\server.pid`：本地后端进程号，`stop-server.cmd` 用它停止服务

第一次启动时，如果新的 `yah` 数据目录不存在，会从旧的 Electron 目录
`%APPDATA%\miniharness-electron` 复制数据库和设置；如果数据库还没有会话，会尝试导入旧的 `chats.json`，成功后把原文件
重命名为 `chats.json.pre-sqlite` 作为备份；也会尝试从旧版 `%APPDATA%\miniharness`
迁移 `chats.json` 和 `settings.json`（`api_key` → `apiKey`，`window.w/h` → `width/height`）。

API key 和旧版一样是明文存在 `settings.json` 里；本地应用，没接 Windows Credential
Manager。这里存的是 OpenCode Go 的 key，不是 DeepSeek 官方 API key。只有本地后端读取它，
桌面端和远程网页都拿不到明文；远程入口只返回 `hasApiKey`。

## 外观

页面是扁平化暖色主题，使用 `assets\fonts` 里的 Resource Han Rounded CN 圆体（Regular / Bold，SIL OFL，许可证见 `assets\fonts\OFL-ResourceHanRounded.txt`）：

- 整个窗口使用纯色奶油底，没有阴影或 backdrop blur；当前展开的条目有一层很淡的圆角暖色底，Space 输入框的透明毛玻璃遮罩除外；
- 每个对话回合用左侧一条暖色竖线包住，回答与过程用字号和缩进分层；
- 输入框、设置、raw 查看器和切换界面都是纯色平面面板；所有全屏弹层和弹出面板统一 18px 圆角；
- 禁用所有原生 hover tooltip，按钮只保留 `aria-label` 供辅助技术使用；
- 可滚动内容和弹层上下边缘使用与主界面一致的渐隐/模糊；
- 窗口使用透明 Electron 窗口 + CSS 18px 圆角，比 Windows 11 DWM 原生圆角更大；最大化时自动改为直角；
- 透明无边框窗口没有系统缩放边框，边缘 5px 的手柄负责缩放，光标会在边缘变成对应方向的缩放箭头；
- 系统不支持透明窗口时只影响圆角，不影响布局和功能。

## Tool calling

- 每次请求带 `tools: [web_search, read_file, ...MCP tools]` 和 `tool_choice: 'auto'`。
- 流式响应里的 `delta.tool_calls` 按 `index` 把 `function.arguments` 拼起来。
- 模型要工具时：把 assistant 的 tool_calls 放回 messages，顺序执行工具，追加
  `role: 'tool'` 结果，再请求模型；最多 **6 轮**。
- 工具执行期间，调用参数和返回结果合并到同一个「工具调用」卡片里：展开后先显示「调用参数」，再显示「返回结果」；返回前显示「等待工具返回…」，不会拆成两个气泡。正文继续流式输出。
- 工具调用和结果作为步骤持久化；每次模型请求的原始 body 也存 SQLite，可在卡片上双击查看。

`web_search` 抓 `https://html.duckduckgo.com/html/?q=...`，解析 `result__a` /
`result__snippet`，把 `uddg=` 重定向解成真实 URL，去标签、解 HTML 实体。免费、无 key，
但 DuckDuckGo 可能限流/弹 CAPTCHA；这时返回 `tool error`，模型可以换个说法再搜。

`read_file` 读取本地 UTF-8 文本文件，返回带行号的内容；支持 `offset` / `limit` 分页
（默认 200 行，最多 2000 行 / 100k 字符），自动拒绝目录和二进制文件。相对路径按后端
进程工作目录解析，跨项目读取建议用绝对路径。

## MCP

MCP 工作区从环形菜单的 `MCP` 扇区打开。YAH 会自动继承 OpenCode 配置里的 MCP 服务器，
读取顺序是全局 `~/.config/opencode/opencode.json(c)`、`%APPDATA%` / `%LOCALAPPDATA%` 下的
OpenCode 配置、OpenChamber managed 配置，最后是当前 workspace 及各级父目录的
`opencode.json(c)` / `.opencode/opencode.json(c)`；后面的层覆盖前面的同名服务器。

OpenCode 里的服务器是只读继承：YAH 里会显示「OpenCode」来源，不能编辑或删除；改
OpenCode 配置后重新打开 MCP 页面（或调用 `/api/mcp/state`）就会同步。OpenCode 中
`enabled: false` / `disabled: true` 的服务器会显示为「已禁用」，但不会自动连接。

YAH 自己添加的服务器保存在 `%APPDATA%\yah\mcp.json`，也可以直接粘贴 OpenCode / Claude
风格的 JSON：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\Dev"]
    },
    "remote": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

也支持 `mcp.servers`、`servers`、数组和单个服务器对象。表单和 JSON 两种添加方式可以混用；
编辑服务器时只能改表单（避免 JSON 里漏字段覆盖掉原有配置）。

- 传输：STDIO（`command` + `args` + `cwd` + `env`）、Streamable HTTP（`url` + `headers`）、
  legacy SSE（`type: "sse"` + `url`）。
- 启动时所有启用的服务器自动连接；失败后按 5s / 10s / 20s / 40s / 60s 退避重连。MCP 工作区里的
  「重连」和「刷新」只影响连接与能力缓存，没有关闭 MCP 的开关；OpenCode 禁用的服务器不会连接。
- 每个已连接服务器的 tools 会自动合并进 agent 工具列表，所有对话都能调用，不需要插入。
  工具名是 `mcp__<server>__<tool>`（服务器名和工具名里的非字母数字字符会换成 `_`）。
- 工具结果会转成纯文本回给模型；图片、二进制、resource_link 用占位文字表示。资源、提示词和
  工具结果都可以在 MCP 工作区里点「插入到对话」，插入到 Space 输入框，编辑后再发送。
- 工具、资源、提示词都支持表单/JSON 参数（工具）、手动调用、原始响应 JSON、日志
  （protocol / stderr / stdout / info）和概览（serverInfo、capabilities、instructions、配置）。
- MCP 日志和连接状态通过 `/api/mcp/events` SSE 实时推送；所有接口和聊天接口一样受远程
  Basic Auth 保护。

测试用 `test-fixtures/mcp-server.js`（STDIO）和 `test-fixtures/mcp-http-server.js`
（Streamable HTTP），`npm test` 会覆盖握手、工具调用、资源读取、提示词获取和工具名映射。

## 和 Rust 版的差异

- 用 Chromium 渲染，字体/布局与 Slint 版略有差异。
- 背景是纯色奶油底 + 透明窗口的 CSS 圆角，不再是桌面截图快照；没有“快照过期”的问题，
  也不依赖系统 acrylic。
- 没有 `jsonview` / 点气泡看 raw request：界面上只显示对话本身。
- 仍然没有取消在途请求的按钮；一次只允许一个请求。

## 已知限制

- 只在 Windows 上实际验证；Electron 其他平台能启动，但没有 acrylic。
- DuckDuckGo 是抓公开 HTML，没有官方 SLA。
- 工具串行执行，没有并行；MCP 工具调用同样走串行队列。
- 窗口位置/大小会保存；换了显示器后按工作区钳制。
