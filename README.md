# YAH - Yet Another Harness

YAH 是 `D:\Dev\Harness\yah` 里的 Electron 聊天 harness，保留原来 miniharness 的核心体验：

- 无边框、扁平暖色桌面窗口，单一浅色主题（奶油底 + 琥珀/陶土强调），没有深浅切换
- DeepSeek V4.1 Flash 流式对话（通过 OpenCode Go 的 OpenAI 兼容端点）
- tool calling loop（模型 → 工具 → 模型）
- 免费 `websearch`（DuckDuckGo HTML，不需要 API key）
- 所有对话条目同宽，占满窗口宽度，只留很窄的左右边距
- 没有标题栏：按住任意非交互区域都能拖动窗口，拖动窗口边缘可缩放
- 禁用 Chromium 默认的中键拖拽/自动滚动，中键不会进入滚动模式
- 所有面板右上角都没有最小化 / 最大化 / 关闭按钮；三个窗口操作只放在 Tab 工作区空白处的右键菜单里
- 没有聊天顶栏和底部输入框：会话内容占满整个窗口高度；按 Space 打开居中的输入框
- Space 输入框：透明毛玻璃高斯模糊遮罩；输入框为空时再按 Space 关闭；点击输入框外关闭，按住拖动则优先拖动窗口；Enter 发送，Shift+Enter 换行，Esc 关闭；关闭时保留草稿，新对话会清空
- 没有侧边栏；全局屏蔽原生 Tab 焦点切换，Tab 只用于按住打开全屏工作区，松开收起，支持键盘选择和删除；Shift / Ctrl / Alt + Tab 不触发切换器
- Tab 工作区使用和 Space 输入框一致的透明磨砂玻璃：半透明奶油底 + 18px 高斯模糊，背后的聊天内容会透出来
- 扁平化界面：没有阴影和模糊面板；用回合竖线、细竖线、文字层级和很淡的圆角暖色底区分，例外是 Space 输入框和 Tab 工作区的透明毛玻璃遮罩
- 双击打开的全文页不再新建窗口，而是像 Space / Tab 一样盖在主界面上的应用内全屏磨砂页：半透明奶油底 + 18px 高斯模糊，直接显示原内容；可以拖拽选中文字，右键或 Esc 返回
- 全局使用 Resource Han Rounded CN（资源圆体，SIL OFL）：界面、对话正文、工具/JSON 查看器统一圆体
- 对话正文重新排版：回答 15.5px、过程 13px、1.8 行高、居中阅读列、统一段落间距；`一、二、三、` 这类章节标题自动加粗并着色
- 聊天内容接近窗口上下边缘时渐隐范围更宽、更明显，不会生硬地被边界切断
- 对话按回合分组：每个回合用左侧一条暖色竖线包住；用户 prompt 始终显示，回答是主内容，思考和工具作为次级过程
- 用户 prompt 直接作为回合开头，不再有左侧 `YOU` / `YAH` 角色列；回合之间 48px 间距
- 思考过程单独显示为 `思考` 条目，和最终 `回复` 分开；回传按 pi 风格处理：同一 provider/api/model 时作为 assistant 消息的 `reasoning_content` 回传，不拼进 `content`，换模型时丢弃
- 每个回合的最终回复标题旁显示 token 用量 `输入总共 / 命中百分比 / 输出总共`（如 `402 / 0% / 3`），数据随消息持久化到 SQLite
- 回答和过程条目的标题行及折叠预览可点击展开/折叠；按住并拖动超过 4px 则改为拖动窗口，松开后不会误触展开/折叠
- 展开一条时其他条目自动折叠；「过程」分组可以单独折叠/展开，默认展开；生成中自动跟随最新条目，非生成时默认展开最后一条回答
- 折叠时在标题行下方保留一行内容预览（取正文首行，超出省略），不展开也能看出大概内容；展开后预览收起
- 折叠条目透明，hover 出现圆角暖色底；展开的条目用整卡圆角暖色底，背景随内容一起展开，约 180ms 背景过渡 + 200ms 高度过渡
- 每个回合的思考、工具调用和过程文字收在一个可折叠的「过程」标签下，默认展开；「过程」和「回复」使用相同的「圆点 + 标签」布局，点颜色不同，左边缘对齐；过程里的标题和正文再缩进 16px 体现层级；过程文字更小更淡，当前展开的过程卡片只用更浅的暖色底
- 展开条目时固定当前滚动位置，不会因为高度变化丢失阅读位置；如果上方有折叠/展开的条目导致高度变化，会实时校正滚动位置，保持被展开条目的标题位置不变
- 展开正文默认最多 10 行，超出部分底部渐隐；双击正文或折叠预览打开应用内磨砂全文页（不新建窗口），流式内容会实时同步；全文页会把 Markdown 渲染成标题、列表、粗体、引用、代码块和表格，代码块带复制按钮；Ctrl + 双击正文查看 raw request body
- 流式输出超过 10 行时，卡片自动跟随最后 10 行，顶部渐隐、最新一行保持清晰；输出结束后回到前 10 行
- 全文磨砂页是唯一可以拖拽选中文字的地方，按住左键拖动不会移动窗口；右键或 Esc 返回；主界面和其他面板不响应框选
- 每个 block 标题后显示性能数据：LLM 的思考和回复显示首 token 延迟与生成速度（tok/s），本地工具显示实时运行时间，结束后显示总耗时
- 每个回合左侧竖线末端（回合底部）显示该回合结束时的上下文窗口占用百分比，按 1M 上下文和最后一轮 prompt + output 计算；左对齐挂在竖线末端
- 发出问题后、首个 token 到达前，回复卡片会先展开并显示闪烁光标；生成过程中光标跟在最后一段文字后面
- Ctrl + 滚轮按对话回合导航：跳到上/下一个回合，空间足够时把目标回合顶到可视区顶部，并让该回合标题短暂高亮闪烁；普通滚轮仍是连续滚动
- Shift + 滚轮：上滚直接回到对话顶部并停止跟随，下滚直接回到最底部并重新锁定跟随；默认锁定在最底部，新生成会持续带动滚动，普通滚轮向上会解除锁定，滚回底部后恢复
- Ctrl + 1 / 2 / 3 是三档折叠预设：`1` 只显示问题（过程组和回复都折叠）；`2` 显示问题 + 完整回复（过程组折叠）；`3` 显示问题 + 完整回复 + 展开的过程组，但过程里的每个 block 仍保持折叠；正在生成的回复在三种模式下都会展开显示，`1`/`2` 生成过程中隐藏过程组，`3` 展开过程组，生成结束后回到该模式的历史显示；再按一次同一个快捷键回到普通模式
- 每个对话单独保存折叠状态（展开的条目、折叠的过程组、当前的 Ctrl+1/2/3 预设），切换对话、开始生成或重启后都按原样恢复；新对话第一次打开时自动记录
- 条目展开/折叠和 Tab 切换界面都有过渡动画；Tab 界面约 0.1s 淡入淡出
- Tab 工作区是全屏左右分栏：左边项目、右边对话，没有顶部标题和底部提示，所有操作按钮只显示图标
- Tab 工作区保持极简：项目行只显示名称，对话行只显示标题；当前项目用左侧色条标记，当前对话用圆点标记
- Tab 工作区：项目行悬停立即切换项目；对话行悬停只高亮，松开 Tab 才选中并收起面板；项目列表末尾的 `+` 行点击新建项目，悬停项目后按空格新建对话；设置 / 删除按钮只响应点击
- 新对话还没有消息时，标题跟随输入框里的第一句；第一句发出后由 LLM 生成一个短标题
- Tab 工作区的对话行后续可以展开查看 subagent；现在暂不展开
- 项目、项目归属和对话一起持久化到 SQLite；工作区空白区域仍然可以按住左键拖动窗口
- 所有菜单、浮层、工作区和表单共用同一套暖色表面：面板 18px、菜单 14px、卡片 12px、控件 9px 圆角；按钮、输入框、空状态、侧栏宽度和顶部间距统一，列表选中状态统一为暖色底（对话列表用圆点），不再在名字前加竖杠
- 所有弹出框、菜单和工作区使用更透明的暖色磨砂背景，保留原有背景模糊效果；右键菜单、Agent 菜单、Skill 联想、设置 / 确认面板和工作区都使用同一套玻璃质感；文字和选中态保持清晰
- 所有弹窗、面板和菜单不再显示顶部标题，只保留内容与操作；MCP 工作区、MCP 配置、usage 面板、问题面板和全文页也都没有标题栏
- 每个对话顶部、第一条消息之前把 `MCP`、`SYSTEM PROMPT`、`AGENTS.MD` 三个 block 放在同一个上下文组里，组后与实际消息留出间隔；`SYSTEM PROMPT` / `AGENTS.MD` 默认折叠，点击标题即可折叠 / 展开，使用和对话「过程」组一致的圆点、hover 暖色底和高度过渡；折叠时只保留标题行，不显示内容，也没有右侧箭头，折叠状态随会话保存。`SYSTEM PROMPT` 显示当前会话所选 Agent 的提示词，没有时回退到会话 system prompt。`AGENTS.md` / `agent.md` 在对话开始时从项目目录读取一次并随会话保存，之后文件变化不影响当前对话；内容会以 `# AGENTS.md` 注入 system prompt。AGENTS.md 为空时折叠状态右侧显示 `EMPTY`，展开后内容也是 `EMPTY`，不会写进上下文
- 有弹窗（设置、raw 查看器、MCP、tool、改名/确认、全文磨砂页）打开时，右键等于关闭弹窗
- `question` 是系统工具：模型可以在执行中暂停并向你提问，一次最多 5 个问题，可分多轮；聊天底部会上滑一块磨砂提问面板，每个选项都能单选 / 多选，也可以自己输入答案；关闭面板等于取消这次提问
- 主界面按住右键约 150ms 弹出竖向菜单：上方是 usage 面板，下方是 Agent、tool、Skill、MCP 四个独立玻璃按钮，每个按钮与 usage 面板等宽；菜单会出现在鼠标左侧或右侧，拖动到按钮上高亮，松开右键执行，松开在空白处直接关闭
- Tab 工作区按住右键弹出同样的竖向菜单：项目上显示「改名 / 配置目录 / 删除」，具体对话上只显示「改名 / 删除」（MCP 只在对话顶部的 MCP 块里配置），空白处显示「设置 / 最小化 / 放大 / 关闭」，关闭为红色；设置不再放在左下角，每个操作都是独立按钮，不再放在同一个框里
- Tab 工作区左侧栏只显示项目名和对话名，名字后面不放任何图标；删除通过右键菜单完成
- 新建项目会弹出文件夹对话框：虚线框中间只保留一个文件夹图标，可以把任意多个文件夹拖进去，也可以点击虚线框选择；没有目录时不再显示提示文字；项目名称输入框和拖放框使用同一套磨砂玻璃背景，至少有一个开发目录才能创建项目。右键项目可以随时「配置目录」
- 项目目录保存在 SQLite 的 `projects.directories`；`read`、`write`、`edit`、`glob`、`grep`、`patch`、`look_at` 只允许访问当前项目目录下的文件。越界时工具调用会暂停，弹出 `TOOL ACCESS` 审核窗：点「允许一次」继续，点「拒绝」返回 `access denied by user`。连续出现的审核会排队，拒绝当前审核后下一个审核仍会显示；审核请求 10 分钟无人处理会自动按拒绝处理，避免对话永久卡住
- 所有删除都是两步：松开「删除」按钮后先弹出确认框，确认后才真正删除；不会因为鼠标拖到删除项就删除
- 删除项目会一次性删除项目本身以及里面的所有对话记录；删除最后一个项目后保持无项目状态，不会自动创建默认项目，需要重新点 `+` 新建；删除对话、排队消息、MCP 服务器也都遵循同样的两步确认
- 对话面板里按 Space 总是打开输入框（焦点在按钮 / 消息块上时也一样，不会触发折叠或按钮点击）；输入框为空或只有空格、且没有挂 Skill 时，再按 Space 关闭输入框；有文字或已挂 Skill 时 Space 才作为空格
- 每个对话顶部只显示一个 MCP 摘要按钮（如 `MCP 5/12`）；点击打开居中的磨砂玻璃配置页，以 grid 按钮墙列出所有服务器，点击按钮切换该对话的开启 / 关闭；开关按会话持久化，关闭的服务器不会出现在该对话的工具列表里（会让 prompt cache 失效）
- 输入框（Space）里：新对话（还没有任何消息）上方只显示 MCP 摘要按钮；已有消息的对话上方只显示排队消息框。生成中仍可继续输入，消息按顺序排队、一行一条，左侧拖动排序，行尾是编辑 / 立即发送 / 删除三个纯图标按钮；当前生成结束后自动按顺序处理队列；这两块都是和输入框同宽的圆角矩形
- 新建对话默认继承同项目上一个对话的 MCP 服务器开关配置
- Skill 是带 frontmatter 的 Markdown 文件（`name` / `description` / `keywords` / `category`），放在项目 `skills/`（内置）或 `%APPDATA%\yah\skills`（用户）；内置包含 `skills/test-skill.md` 测试 Skill
- Skill 页新增「系统」分组：`compact` / `goal` 是内置系统 Skill，不是可编辑的 Markdown，而是固定指令；只读，不能修改，输入 `/` 可以像其他 Skill 一样搜索和调用
- 上下文压缩按 OpenCode 的方式工作：每次请求前用「已测量的 prompt + 之后新增内容的估算」判断，达到模型窗口减去 10%（至少 16k）时自动压缩；保留最近约 15k tokens，旧历史写成结构化 checkpoint。手动 `/compact` 或在 Skill 里选 `compact` 不会立刻执行，而是先作为 `/ compact` 标记放进输入框，可以和其他消息一起排队；发送后压缩结果显示为一条独立的 `CONTEXT COMPACTED` 消息（manual、压缩前后 token 数、可展开摘要），完成后旧对话被冻结、不能再发消息，并自动新建一个 `#1 原标题` 的对话，把同一条压缩摘要放在开头，接着在新对话里继续聊。自动压缩仍在过程组里显示 `CONTEXT COMPACTED` block
- Goal 模式按 OpenChamber 的方式实现：`/goal` 打开目标对话框，`/goal <目标>` 直接开始；目标保存在当前对话，输入框上方显示目标状态条（进度、token、暂停 / 继续 / 清除）。每轮结束后会运行一个独立的 `GOAL CHECK` block，用三个 yes/no 问题判断 `complete` / `continue` / `blocked`；未完成会自动继续，直到完成、被阻塞、token 预算用完或达到自动轮次上限
- 在输入框开头输入 `/` 会在光标位置弹出搜索式 Skill 联想：按名称、描述、关键词匹配当前对话可用的 Skill，上下键移动、回车或点击选择；输入完整的 Skill 名称或 id 后会自动识别并关闭联想，后面可以直接跟空格、参数或正文，不需要回车选择；只有部分匹配时才需要上下键 / 回车选择。选中后输入框本身不变色，只在输入框上方显示一个带颜色的 `/ Skill` 标记，按 Backspace 或点 × 整体删除；带参数的 MCP Skill 会先弹出参数表单
- 附加的 Skill 在发送时解析并注入该次请求的 system prompt（`# Active Skills`），不会写进用户输入；排队消息会一起保存自己的 Skill
- 已连接且当前对话启用的 MCP 服务器会把 prompts 暴露为临时 Skill；切换 MCP 开关后列表实时更新
- Agent 面板从右键菜单的 Agent 入口打开，左右分栏：左侧列出 Agent 和一个只有 `+` 的新建行，右侧配置名称、提示词和工具权限；内置「Build」始终存在，可以修改但不可删除，自定义 Agent 配置保存在 `%APPDATA%\yah\agents.json`
- Agent 提示词会以 `# Agent Context · 名称` 的形式插入该次请求的 system prompt（在对话上下文之前）；内置 `Build` 的提示词要求所有最终回复使用 Markdown；工具权限和工具目录一样左右分栏：左列第一行是「允许所有工具」，下面是分类（搜索 / 文件 / 系统 / 代理 / 会话），右列第一行是搜索框，下面是当前分类的工具；可以勾选所有工具、整类工具，也可以逐个勾选，不显示任何数量统计；MCP 工具不进入 Agent 工具权限，也不受 Agent 工具勾选限制，仍由对话的 MCP 开关控制，并继续在 tool 面板里查看；不勾选则不能调用工具
- 输入框底部只显示当前 Agent 名字（如 `Build`），居中显示并与右侧发送按钮垂直中线对齐，是一段可点击的文字，没有额外标签和三角；点击后在上方居中展开紧凑的暖色磨砂下拉菜单选择 Agent，Agent 多时列表可滚动。每个对话必须有一个 Agent，新对话默认使用「Build」；按对话保存选择，新对话继承同项目上一个对话的 Agent；排队消息会保存自己的 Agent
- 圆环外侧第一个位置是一个只读的 `usage` 圆角面板：显示 OpenCode Go 的 5 小时 / 本周 / 本月额度百分比和重置时间，不参与鼠标交互；数据由后端 `/api/usage` 获取并缓存 60 秒
- tool 和 Skill 面板是无标题的左右分栏：tool 页左侧按分类列出内置工具（搜索 / 文件 / 系统），代理和会话类工具不在 tool 面板显示（仍可用于 Agent），右侧每个工具是一张独立卡片，默认折叠，只显示名称、参数数量和 chevron；点击展开说明和参数，一次最多只展开一个工具。Skill 页使用同样的分类侧栏和折叠卡片：左侧平铺系统、本地分类（内置 / 用户 / 绘画等，由 frontmatter `category` 决定）和 MCP 服务器（显示为 `MCP · 名称`），右侧每个 Skill 是一张和工具相同的卡片，默认折叠，展开后显示说明、固定指令和 MCP 参数；MCP 工具只出现在独立的 MCP 工作区，不混进 tool 面板；MCP 工作区左侧服务器、右侧工具 / 资源 / 提示词 / 日志 / 概览；没有内容时显示空状态
- Agent、tool、Skill、MCP 四个工作区共用一套字体层级：15px 标题、13.5px 条目名称、13px 正文、12px 紧凑说明、11px 次要信息和 10.5px 分组标签；侧栏、卡片圆角、悬停和选中态使用同一套样式
- 聊天里的 MCP 工具调用显示为「MCP 调用」，不会和内置工具的「工具调用」混在一起；调用参数和返回结果仍然合并在同一个卡片里；工具返回后右侧显示 `ok` / `error` 圆角标签，错误卡片带红色侧边和浅红背景，过程组标题会汇总错误数量
- 所有空状态（无对话、无消息、无工具/Skill/MCP、raw 为空、全文为空）统一在可用区域居中，颜色比正文淡一档
- 工具调用的 JSON 参数和 JSON 输出用带语法着色、可折叠节点的查看器展示
- Ctrl + 双击任意对话卡片可以查看该轮实际发给模型的原始请求 body，完整 JSON 树可逐层折叠
- 所有区域隐藏滚动条，滚轮/触控板仍然可以滚动
- 后端服务用 SQLite（`node:sqlite`，WAL）管理会话；设置和 API key 存 `settings.json`，窗口位置存 `window.json`
- MCP 服务器分两类：OpenCode 配置里的服务器自动继承（只读），以及 YAH 自己的 `%APPDATA%\yah\mcp.json` 自定义服务器；支持 STDIO、Streamable HTTP、legacy SSE，支持表单添加和粘贴 `mcpServers` / `mcp.servers` JSON
- OpenCode 中启用的 MCP 启动时自动连接，默认对所有对话开放；每个对话顶部的 MCP 摘要按钮可以单独开关服务器，关闭后请求里不再带该服务器的工具；OpenCode 中禁用的服务器会显示但不会连接；工具名统一为 `mcp__<server>__<tool>`
- MCP 工作区左侧是服务器列表（顶部没有标题和数字，底部只有「添加服务器」），右侧可以查看 tools / resources / prompts / logs / overview，手动调用工具、读取资源、获取提示词，并把工具、结果、资源或提示词插入输入框；没有服务器时空状态在整个内容区上下居中
- 全局禁用鼠标框选和原生右键菜单；只有输入框保留文本选择

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
server/usage.js    OpenCode Go 额度查询（/api/usage，60 秒缓存）
server/runner.js   agent 主循环、工具执行、消息/事件持久化
server/skills.js   Skill 发现（skills/ + %APPDATA%\yah\skills）与 MCP prompts 转 Skill
server/agents.js   Agent 配置（%APPDATA%\yah\agents.json）：内置 Build + 自定义提示词与工具权限
src/agent-defaults.js 内置 Build 的 id、名称和提示词
server/context.js  项目 AGENTS.md / agent.md 读取与一次性快照
skills/            内置 Skill Markdown（含 test-skill.md）
server/mcp/config.js   MCP 自定义配置存储、JSON 配置解析
server/mcp/opencode.js OpenCode 配置发现与 MCP 服务器继承
server/mcp/transport.js STDIO / Streamable HTTP / legacy SSE 传输
server/mcp/client.js   MCP JSON-RPC 客户端、握手、能力缓存
server/mcp/manager.js  MCP 连接生命周期、自动重连、工具/资源/提示词调用
server/mcp/format.js   MCP 结果转纯文本
src/main.js        Electron 壳：窗口、拖动/缩放、全文窗口、拉起/连接后端
src/preload.js     只暴露窗口拖动/缩放和全文窗口能力
src/deepseek.js    OpenCode Go SSE + tool_calls 累积 + agent loop（后端）
src/tools.js       工具注册表：OpenCode + OMO 合并、MCP 路由、兼容别名
src/tools/         hashline、文件/搜索、shell/后台、会话/任务/目标、子模型、web 工具模块
src/tools/guard.js 项目目录路径守卫：越界时暂停工具并等待人工审批
src/compaction.js  上下文压缩：OpenCode 阈值、checkpoint 模板、最近消息切分
src/goal.js        Goal 模式：目标归一化、审计问题、continue/complete/blocked 判定
src/mcp-registry.js MCP 工具到 OpenAI function 的映射（后端）
src/store.js       chats.db（SQLite/WAL）+ settings.json 原子写 + 旧版迁移
src/renderer.js    网页客户端：聊天、项目工作区、设置、右键菜单、HTTP/SSE
src/mcp-ui.js      MCP 工作区：服务器、工具、资源、提示词、日志、概览
src/index.html     页面骨架
src/styles.css     主题、布局、浮层、输入区
src/resize.js      无边框窗口的边缘缩放手柄（桌面端）
src/resize.css     缩放手柄布局和光标
src/content.html   旧的独立全文窗口页面（代码保留，双击已改为应用内磨砂页）
src/content.css    旧全文窗口排版和圆体（保留）
src/content.js     旧全文窗口渲染和流式更新（保留）
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
  - `sessions`：会话 id、标题、system、排序、该会话禁用的 MCP 服务器、折叠状态（`fold_state` JSON）、排队消息（`pending_queue` JSON）、是否已冻结（`frozen`）
  - `messages`：每个会话的消息角色和文字；手动压缩会写入一条 `Compact` 消息，在聊天里显示为独立的 `CONTEXT COMPACTED` 卡片
  - `steps`：工具调用/返回、文本片段、轮次、工具耗时和 LLM 首 token/tok-s 指标
  - `requests`：每条助手消息每轮的原始请求 body（gzip 压缩的 JSON BLOB）
  - `runs`：一次 agent 执行的状态
  - `events`：按会话递增的事件日志，用于 SSE 断线重连补发
  - `app_state`：当前会话 id 和标题序号
  - 运行时还会出现 `chats.db-wal` / `chats.db-shm`；备份时不要只复制 `chats.db`
- `%APPDATA%\yah\settings.json`：API key（后端读取，网页端拿不到）
- `%APPDATA%\yah\mcp.json`：YAH 自己添加的 MCP 服务器配置（STDIO 命令/参数/环境变量，或远程 URL/Headers）
- `%APPDATA%\yah\agents.json`：自定义 Agent 和内置 `Build` 的修改；内置 `Build` 始终可用、不可删除
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

## 工具集（OpenCode + OMO）

YAH 的本地工具注册表合并了 OpenCode 内置工具和 oh-my-opencode（OMO）的工具；同名工具按 OMO 优先覆盖 OpenCode。

- OpenCode：`read`、`write`、`shell`、`webfetch`、`websearch`、`patch`、`question`、`SystemInfo`、`list_mcp_resources`、`read_mcp_resource`、`session_rename`、`models`、`worktree_*`
- OMO 优先：`glob`、`grep`、`edit`（LINE#ID hashline）、`skill`
- OMO 常驻 / 条件工具：`session_list/read/search/info`、`task_create/get/list/update`、`background_output/cancel`、`monitor_start/stop/list/output`、`interactive_bash`、`task/subagent/call_omo_agent/delegate_task`、`create_goal/update_goal/get_goal`、`skill_mcp`、`look_at`、`team_*`
- 兼容别名：`read_file`、`hashline_edit`；旧调用名 `web_search` 仍可执行，但不再作为工具暴露
- `read` 输出 `LINE#ID|content`；`edit` 用 LINE#ID 锚点批量修改，也支持 `path` + `oldString` + `newString`
- OMO 的 `team_*`、`background_*`、`monitor_*` 在 YAH 里是本地记录 / 进程管理版本；`task`/`subagent` 是单次子模型调用；`interactive_bash` 在 Windows 上退化为普通 shell

## Tool calling

- 每次请求带 `tools: [...OpenCode + OMO 合并工具, ...MCP tools]` 和 `tool_choice: 'auto'`。
- 流式响应里的 `delta.tool_calls` 按 `index` 把 `function.arguments` 拼起来。
- 模型要工具时：把 assistant 的 tool_calls 放回 messages，顺序执行工具，追加
  `role: 'tool'` 结果，再请求模型；最多 **6 轮**。第 6 轮工具执行完后不再报错，
  而是追加一条总结指令、不带工具再请求一次，让模型用当前已有信息直接给出最终回复。
- 工具执行期间，调用参数和返回结果合并到同一个「工具调用」卡片里：展开后先显示「调用参数」，再显示「返回结果」；返回前显示「等待工具返回…」，不会拆成两个气泡。正文继续流式输出。
- 工具调用和结果作为步骤持久化；每次模型请求的原始 body 也存 SQLite，可在卡片上双击查看。

`websearch` 抓 `https://html.duckduckgo.com/html/?q=...`，解析 `result__a` /
`result__snippet`，把 `uddg=` 重定向解成真实 URL，去标签、解 HTML 实体。免费、无 key，
但 DuckDuckGo 可能限流/弹 CAPTCHA；这时返回 `tool error`，模型可以换个说法再搜。

`read` / `read_file` 读取本地 UTF-8 文本文件，返回带 `LINE#ID` 的内容；支持 `offset` / `limit` 分页
（默认 2000 行），自动拒绝目录和二进制文件。相对路径按后端进程工作目录解析，跨项目读取建议用绝对路径。
`write` 写文件并自动创建父目录；`edit` 支持 LINE#ID 锚点和 `oldString`/`newString` 两种模式。

`question` 让模型在任务中途停下来提问：一次调用最多 5 个问题，每个问题可带选项（`multiple: true` 支持多选），前端会自动追加「其他（自己输入）」。答案通过 `POST /api/questions/:id` 回传，工具返回 `User has answered your questions: ...`；关闭面板会返回 `tool error: The user dismissed this question`。

`SystemInfo` 快速返回本地系统快照：日期、时间、时区、位置（cwd / home / hostname / 时区城市和区域）、操作系统、架构、用户、系统语言、CPU、内存和 Node 运行时。全部本地读取，不联网。

## MCP

MCP 工作区从右键菜单的 `MCP` 入口打开。YAH 会自动继承 OpenCode 配置里的 MCP 服务器，
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
