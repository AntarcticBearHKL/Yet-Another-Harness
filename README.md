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
- 对话正文重新排版：回复和提问 13.5px、过程 13px、1.7 行高、居中阅读列、统一段落间距；`一、二、三、` 这类章节标题自动加粗并着色
- 提问、过程、回复是同一缩进层级的三个顶层块；提问显示为带圆点和「提问」标题的可折叠卡片，折叠时一行显示输入预览，展开显示正文；过程里的步骤再深一层缩进
- 聊天内容接近窗口上下边缘时渐隐范围更宽、更明显，不会生硬地被边界切断
- 对话按回合分组：每个回合用左侧一条暖色竖线包住；用户 prompt 始终显示，回答是主内容，思考和工具作为次级过程
- 用户 prompt 直接作为回合开头，不再有左侧 `YOU` / `YAH` 角色列；回合之间 48px 间距
- 思考过程单独显示为 `思考` 条目，和最终 `回复` 分开；回传按 pi 风格处理：同一 provider/api/model 时作为 assistant 消息的 `reasoning_content` 回传，不拼进 `content`，换模型时丢弃
- 每个回合的最终回复标题旁显示该回合最大上下文那一轮的 token 用量 `输入 / 命中百分比 / 输出`（如 `22k / 97% / 241`），悬停可看全部轮次的合计；数据随消息持久化到 SQLite
- 回答和过程条目的标题行及折叠预览可点击展开/折叠；按住并拖动超过 4px 则改为拖动窗口，松开后不会误触展开/折叠
- 展开一条时其他条目自动折叠；「过程」分组可以单独折叠/展开，默认展开；生成中自动跟随最新条目，非生成时默认展开最后一条回答
- 折叠时在标题行下方保留一行内容预览（取正文首行，超出省略），不展开也能看出大概内容；展开后预览收起
- 折叠条目透明，hover 出现圆角暖色底；展开的条目用整卡圆角暖色底，背景随内容一起展开，约 180ms 背景过渡 + 200ms 高度过渡
- 每个回合的思考、工具调用和过程文字收在一个可折叠的「过程」标签下，默认展开；「过程」和「回复」使用相同的「圆点 + 标签」布局，点颜色不同，左边缘对齐；过程里的标题和正文再缩进 16px 体现层级；过程文字更小更淡，当前展开的过程卡片只用更浅的暖色底
- 展开条目时固定当前滚动位置，不会因为高度变化丢失阅读位置；如果上方有折叠/展开的条目导致高度变化，会实时校正滚动位置，保持被展开条目的标题位置不变
- 折叠状态把标题、工具名、预览、耗时/状态放在同一行，预览超出时省略；点击展开后预览隐藏，正文在标题下方展开
- 展开正文默认最多 10 行，超出部分底部渐隐；双击正文或折叠预览打开应用内磨砂全文页（不新建窗口），流式内容会实时同步；全文页会把 Markdown 渲染成标题、列表、粗体、引用、代码块和表格，代码块带复制按钮；Ctrl + 双击正文查看 raw request body
- 流式输出超过 10 行时，卡片自动跟随最后 10 行，顶部渐隐、最新一行保持清晰；输出结束后回到前 10 行
- 全文磨砂页是唯一可以拖拽选中文字的地方，按住左键拖动不会移动窗口；右键或 Esc 返回；主界面和其他面板不响应框选
- 每个 block 标题后显示性能数据：LLM 的思考和回复显示首 token 延迟与生成速度（tok/s），本地工具显示实时运行时间，结束后显示总耗时
- 每个回合左侧竖线末端（回合底部）显示该回合的上下文窗口占用百分比，按 1M 上下文和该回合发送过的最大 prompt + output 计算；左对齐挂在竖线末端
- 每次请求发出后、首个 token 到达前，过程组末尾会先出现一个空的「思考」block 并显示闪烁光标；工具调用结束后下一轮请求也会立即出现同样的等待 block，不会停在工具结果上；如果模型没有思考、直接回复，这个空等待 block 会在回复出现时消失
- Ctrl + 滚轮按对话回合导航：跳到上/下一个回合，空间足够时把目标回合顶到可视区顶部，并让该回合标题短暂高亮闪烁；普通滚轮仍是连续滚动
- Shift + 滚轮：上滚直接回到对话顶部并停止跟随，下滚直接回到最底部并重新锁定跟随；默认锁定在最底部，新生成会持续带动滚动，普通滚轮向上会解除锁定，滚回底部后恢复
- Ctrl + 1 / 2 / 3 是三档折叠预设：`1` 只显示问题（过程组和回复都折叠）；`2` 显示问题 + 完整回复（过程组折叠）；`3` 显示问题 + 完整回复 + 展开的过程组，但过程里的每个 block 仍保持折叠；正在生成的回复在三种模式下都会展开显示，`1`/`2` 生成过程中隐藏过程组，`3` 展开过程组，生成结束后回到该模式的历史显示；再按一次同一个快捷键回到普通模式
- 每个对话单独保存折叠状态（展开的条目、折叠的过程组、当前的 Ctrl+1/2/3 预设），切换对话、开始生成或重启后都按原样恢复；新对话第一次打开时自动记录
- 条目展开/折叠和 Tab 切换界面都有过渡动画；Tab 界面约 0.1s 淡入淡出
- Tab 工作区是全屏左右分栏：左边项目、右边对话，没有顶部标题和底部提示，所有操作按钮只显示图标
- Tab 工作区保持极简：项目行只显示名称，对话行只显示标题；当前项目用左侧色条标记，当前对话用圆点标记
- Tab 工作区：项目行悬停立即切换项目；对话行悬停只高亮，松开 Tab 才选中并收起面板；项目列表末尾的 `+` 行点击新建项目，悬停项目后按空格新建对话；设置 / 删除按钮只响应点击
- 新对话还没有消息时，标题跟随输入框里的第一句；第一句发出后由 LLM 生成一个短标题
- 子代理对话作为独立对话出现在 Tab 列表里，带「子代理」徽章，只读；`/fork` 出来的对话没有徽章，可以继续编辑
- 项目、项目归属和对话一起持久化到 SQLite；工作区空白区域仍然可以按住左键拖动窗口
- 所有菜单、浮层、工作区和表单共用同一套暖色表面：面板 18px、菜单 14px、卡片 12px、控件 9px 圆角；按钮、输入框、空状态、侧栏宽度和顶部间距统一，列表选中状态统一为暖色底（对话列表用圆点），不再在名字前加竖杠
- 所有弹出框、菜单和工作区使用更透明的暖色磨砂背景，保留原有背景模糊效果；右键菜单、Agent 菜单、Skill 联想、设置 / 确认面板和工作区都使用同一套玻璃质感；文字和选中态保持清晰
- 所有弹窗、面板和菜单不再显示顶部标题，只保留内容与操作；MCP 工作区、MCP 配置、usage 面板、问题面板和全文页也都没有标题栏
- 每个对话顶部、第一条消息之前把 `MCP`、`SYSTEM PROMPT`、`SYSTEMINFO`、`SAFETY PROMPT`、`AGENTS.MD` 五个 block 按此顺序放在同一个上下文组里，组后与实际消息留出间隔；`SYSTEM PROMPT`、`SAFETY PROMPT`、`AGENTS.MD` 默认折叠，`SYSTEMINFO` 默认展开；点击标题即可折叠 / 展开，使用和对话「过程」组一致的圆点、hover 暖色底和高度过渡；折叠时只保留标题行，不显示内容，也没有右侧箭头，折叠状态随会话保存。`SYSTEM PROMPT` 显示当前会话所选 Agent 的提示词，没有时回退到会话 system prompt。`SYSTEMINFO` 打开对话时自动调用 `systeminfo` 工具并把返回的纯文本注入 block，显示日期、时间、近似地理位置、操作系统、shell、项目工作目录（含只允许读写工作目录内文件、越界需要手动批准的警告）和系统语言，结果按会话和项目目录缓存。`SAFETY PROMPT` 读取会话的 `safetyPrompt`，目前为空。`AGENTS.md` / `agent.md` 在对话开始时从项目目录读取一次并随会话保存，之后文件变化不影响当前对话；内容会以 `# AGENTS.md` 注入 system prompt。任何内容块为空时只在标题行右侧显示 `EMPTY`，没有正文，也不能展开或折叠；AGENTS.md 为空时同样不会写进上下文
- 有弹窗（设置、raw 查看器、MCP、tool、改名/确认、全文磨砂页）打开时，右键等于关闭弹窗
- 改名弹窗的输入框和项目名称输入框使用同一套透明毛玻璃：半透明暖白底 + 10px backdrop blur，面板本身继续使用统一的 glass panel
- `question` 是系统工具：模型可以在执行中暂停并向你提问，一次最多 5 个问题，可分多轮；聊天底部会上滑一块磨砂提问面板，每个选项都能单选 / 多选，也可以自己输入答案；关闭面板等于取消这次提问
- 主界面按住右键约 150ms 弹出竖向菜单：上方是 usage 面板，下方是 Agent、tool、Skill、MCP 四个独立玻璃按钮，每个按钮与 usage 面板等宽；菜单会出现在鼠标左侧或右侧，拖动到按钮上高亮，松开右键执行，松开在空白处直接关闭
- Tab 工作区按住右键弹出同样的竖向菜单：项目上显示「改名 / 配置目录 / 删除」，具体对话上只显示「改名 / 删除」（MCP 只在对话顶部的 MCP 块里配置），空白处显示「设置 / 最小化 / 放大 / 关闭」，关闭为红色；设置不再放在左下角，每个操作都是独立按钮，不再放在同一个框里
- Tab 工作区左侧栏只显示项目名和对话名，名字后面不放任何图标；删除通过右键菜单完成
- 新建项目会弹出文件夹对话框：虚线框中间只保留一个文件夹图标，可以把任意多个文件夹拖进去，也可以点击虚线框选择；没有目录时不再显示提示文字；项目名称输入框和拖放框使用同一套磨砂玻璃背景，至少有一个开发目录才能创建项目。右键项目可以随时「配置目录」
- 项目目录保存在 SQLite 的 `projects.directories`；`read`、`write`、`edit`、`glob`、`grep`、`patch` 只允许访问当前项目目录下的文件。越界时工具调用会暂停，从底部弹出和 question 同一套样式的 `FILE ACCESS` 毛玻璃抽屉：点「允许一次」继续，点「拒绝」会明确返回 `User denied access ...`，让模型选择其他做法或向你确认。审核没有超时，只要不回答 run 就一直停在这一步；连续出现的审核会排队，拒绝当前审核后下一个审核仍会显示
- 所有删除都是两步：松开「删除」按钮后先弹出确认框，确认后才真正删除；不会因为鼠标拖到删除项就删除
- 删除项目会一次性删除项目本身以及里面的所有对话记录；删除最后一个项目后保持无项目状态，不会自动创建默认项目，需要重新点 `+` 新建；删除对话、排队消息、MCP 服务器也都遵循同样的两步确认
- 对话面板里按 Space 总是打开输入框（焦点在按钮 / 消息块上时也一样，不会触发折叠或按钮点击）；输入框为空或只有空格、且没有挂 Skill 时，再按 Space 关闭输入框；有文字或已挂 Skill 时 Space 才作为空格
- 所有带确认按钮的弹窗按 Space 等于点击确认按钮：删除确认的 `Delete`、重命名的 `Save`、项目的 `Create / Save`、Goal 的 `Start Goal`、Skill 参数的 `Attach`、工具授权的 `允许一次`、设置的 `Done`、MCP 服务器表单的 `Save`；焦点在输入框 / 文本域 / 下拉框里时 Space 仍然是空格，项目目录拖放区这类自己处理 Space 的控件保持原行为
- 后台服务：LLM 用 `background_start` 在项目里启动持续运行的服务（dev server、watcher、`npm run dev` 等），每次必须附 `note` 简洁说明用途；工具只返回 id、备注和运行状态，不返回输出或执行结果，服务结束时也不会把任何内容送回对话。服务按项目保存，不属于某个对话；Manager group 里有统一的「后台」管理 node，显示每个服务的备注、创建者、命令和运行状态，创建者或管理员（Manager / 人在画布上）可以停止对应服务；`background_list` / `background_stop` 用于列出和停止，旧的 `background_output` / `background_cancel` / `monitor_output` 已删除。工具面板里是「后台」分类
- 角色：Subagent 分组包含主工程师、信息收集、程序员、测试员、文档写作、代码审查六个固定角色，不再有通用 Build，也没有项目协调 Agent；主工程师负责需求确认、拆解和合并检查，其余 worker 直接处理 Agile 任务，使用 `task_block` / `task_finish`
- `/fork` 系统 Skill：在当前工作目录把当前对话分叉成新的可编辑对话，命名 `#n-对话名`，原对话保持不变；在输入框输入 `/fork [名字]` 或从斜杠列表选择
- Agile 工作区：从 Tab 工作区空白处的右键菜单打开；桌面端打开一个独立窗口（网页端回退为全屏页面），窗口位置和大小会记住。固定六列 设计案 / Backlog / In Progress / Blocked / Finished / Merged；左侧分组和迭代，支持折叠、改名、新建、删除；卡片可以打开任务表单，标题和描述只读，备注仍可添加，备注在 In Progress 期间锁定；Finished 任务被加备注会自动回到 Backlog 并标记返工。支持任务搜索、WIP 上限、迭代日期/目标、显示更新时间和默认 OpenAgile Skill。看板数据存在 `%APPDATA%\yah\agile.json`。Manager 写设计案，主工程师拆成 Backlog 并检查合并，worker 完成后进入 Finished，合并后进入 Merged
- 任务工具：工具面板的「Agile」分类包含 `design_write`、`backlog_list`、`backlog_add`、`iteration_add`、`task_block`、`task_finish`、`task_merge`、`task_reject`；旧的 `agile_*`、`mission_*`、`worknode_result`、`question` 工具已删除
- 系统 node：Manager group 左侧显示 Agile、调度器和后台，右侧显示 Report Hub、审批和问卷。每个 Manager 启动后自动出现 Agile、调度器和后台；发布设计案后自动出现 Report Hub，审批和问卷在 `task_block` 时出现。点击任意管理 node 会打开统一风格的详情页，显示状态、执行步骤和该类型的专属内容（Agile 计数、后台服务列表、报告正文、审批详情或问卷表单）。调度器每 1.5 秒扫描设计案、Backlog、Finished 和阻塞队列：把设计案派给主工程师，把 Backlog 派给 worker 工程师，把 Finished 重新交给主工程师检查合并；主工程师用问卷向用户确认需求，worker 用 `task_finish` 提交结果，Report Hub 更新 Agile 并生成可读报告
- 工程师 node、Agile、调度器、后台、Report Hub、审批和问卷这些单个 node 不能自由拖动，也不能改变位置。Manager group 是一个完整的圆角框，内部固定三列，列与列之间用虚线分割：左列是管理 node（Manager、Agile、调度器、后台），中列是工程师工作 node，右列是报告、审批和问卷等输出。三列不再有各自的标题或独立卡片，所有 node 直接作为框内的行从上往下排列，行与行之间没有高度空隙，也不再使用固定正方形；每行高度由内容决定，新增 node 会直接排到对应列末尾。工程师列的第一个固定是「主工程师」，内部编号 1 和编号 2 的工程师写死存在，不能删除或归档；编号 1 不接实现任务，只负责需求确认、拆解和合并检查，编号 2 起是执行任务的 worker，界面从「工程师 1」开始显示。group 本身仍可拖动：按住任意行或组内空白处都能移动整组，group 之间保留碰撞体积和 16px 间距，拖动时不会互相重叠或覆盖。group 从 Manager 所在位置自动排版，框的高度跟随最高的一列。新建管理 node 时默认创建一个主工程师和一个工程师；之后可以右键管理 node 选「新增工程师」逐个添加，或在「配置」里调整数量。右键管理 node 选择「删除管理 node」会删除整个 group：管理对话、所有工作 node 及其子对话、Agile / 调度器 / 后台 / 报告 / 审批 / 问卷等系统 node、该 Manager 的 Agile 数据和项目后台服务一起删除，不能恢复
- 每个对话顶部只显示一个 MCP 摘要按钮（如 `MCP 5/12`）；点击打开居中的磨砂玻璃配置页，以 grid 按钮墙列出所有服务器，点击按钮切换该对话的开启 / 关闭；开关按会话持久化，关闭的服务器不会出现在该对话的工具列表里（会让 prompt cache 失效）
- 输入框（Space）里：新对话（还没有任何消息）上方只显示 MCP 摘要按钮；已有消息的对话上方只显示排队消息框。生成中仍可继续输入，消息按顺序排队、一行一条，左侧拖动排序，行尾是编辑 / 立即发送 / 删除三个纯图标按钮；当前生成结束后自动按顺序处理队列；这两块都是和输入框同宽的圆角矩形
- 新建对话默认关闭所有 MCP 服务器：MCP 摘要显示 `0/总数`，需要时在对话顶部的 MCP 配置页里手动打开；开关按会话持久化
- Skill 是带 frontmatter 的 Markdown 文件（`name` / `description` / `keywords` / `category`），放在项目 `skills/`（内置）或 `%APPDATA%\yah\skills`（用户）；内置测试 Skill 已删除
- Skill 页新增「系统」分组：`compact` / `goal` / `fork` / `clear` 是内置系统 Skill，不是可编辑的 Markdown，而是固定指令；只读，不能修改，输入 `/` 可以像其他 Skill 一样搜索和调用。`/clear` 会清空当前对话的全部消息和临时状态，回到新对话状态
- 上下文压缩按 OpenCode 的方式工作：每次请求前用「已测量的 prompt + 之后新增内容的估算」判断，达到模型窗口减去 10%（至少 16k）时自动压缩；保留最近约 15k tokens，旧历史写成结构化 checkpoint。手动 `/compact` 或在 Skill 里选 `compact` 不会立刻执行，而是先作为 `/ compact` 标记放进输入框，可以和其他消息一起排队；发送后压缩结果显示为一条 `CONTEXT COMPACTED` 消息（manual、压缩前后 token 数、可展开摘要），原来的全部消息被清空，这条压缩结果成为当前对话的第一条消息，对话本身、标题和画布节点保持不变。自动压缩仍在过程组里显示 `CONTEXT COMPACTED` block，不打断当前这一轮
- Goal 模式按 OpenChamber 的方式实现：`/goal` 打开目标对话框，`/goal <目标>` 直接开始；目标保存在当前对话，输入框上方显示目标状态条（进度、token、暂停 / 继续 / 清除）。每轮结束后会运行一个独立的 `GOAL CHECK` block，用三个 yes/no 问题判断 `complete` / `continue` / `blocked`；未完成会自动继续，直到完成、被阻塞、token 预算用完或达到自动轮次上限
- 在输入框开头输入 `/` 会在光标位置弹出搜索式 Skill 联想：按名称、描述、关键词匹配当前对话可用的 Skill，上下键移动、回车或点击选择；输入完整的 Skill 名称或 id 后会自动识别并关闭联想，后面可以直接跟空格、参数或正文，不需要回车选择；只有部分匹配时才需要上下键 / 回车选择。选中后输入框本身不变色，只在输入框上方显示一个带颜色的 `/ Skill` 标记，按 Backspace 或点 × 整体删除；带参数的 MCP Skill 会先弹出参数表单
- 附加的 Skill 在发送时解析并注入该次请求的 system prompt（`# Active Skills`），不会写进用户输入；排队消息会一起保存自己的 Skill
- 已连接且当前对话启用的 MCP 服务器会把 prompts 暴露为临时 Skill；切换 MCP 开关后列表实时更新
- Agent 面板从右键菜单的 Agent 入口打开，左右分栏：左侧按「管理 / Subagent」分组列出固定配置，右侧显示名称、提示词和工具权限；管理只有一个 Manager；具体工作角色全部在 Subagent：主工程师、信息收集、程序员、测试员、文档写作、代码审查，没有通用 Build，也没有项目协调 Agent；配置完全只读，不能新增、删除或修改
- Agent 提示词会以 `# Agent Context · 名称` 的形式插入该次请求的 system prompt（在对话上下文之前）；每个角色的提示词第一句都是先阅读整个项目目录、README、AGENTS.md、依赖清单和关键源码，理解开发方式后再开始工作。每个 Subagent 的工具权限按角色区分：主工程师有 `task_block` / `task_finish` / `backlog_add` / `task_merge` / `task_reject`、只读代码工具、shell 和 Git 检查 / 合并工具，但没有 `write` / `edit`；worker 有代码工具、自己的 worktree 分支和 `task_block` / `task_finish`，没有合并 / 推送工具。工具权限和工具目录一样左右分栏：左列第一行是「允许所有工具」，下面是分类，右列第一行是搜索框，下面是当前分类的工具；可以浏览分类和搜索，但复选框只展示状态、不响应点击，显示保持原样不做灰色禁用；MCP 工具不进入 Agent 工具权限，也不受 Agent 工具勾选限制，仍由对话的 MCP 开关控制，并继续在 tool 面板里查看
- Manager 的主流程是 `design_write` / `backlog_list` / `iteration_add`：把用户请求整理成严谨的设计案（目标、范围、需求、约束、非目标、验收和待确认问题），写入 Agile 的「设计案」列；调度器把设计案交给主工程师，主工程师用 `task_block` 问卷向用户逐项确认需求（grill me），确认后用 `backlog_add` 拆成互相独立的 Backlog 任务；调度器把 Backlog 分配给 worker 工程师，工程师完成后任务进入 Finished，调度器再把 Finished 交回主工程师；主工程师检查代码和验收标准，用 `task_merge` 合并 Git 分支并进入 Merged，不合格时用 `task_reject` 打回 Backlog
- 调度器详情页会记录每次扫描的设计案 / Backlog / 进行中 / 阻塞 / 待合并 / 已合并数量，以及设计派发、任务分发、阻塞恢复和主工程师合并步骤；端口不消耗模型
- 每个管理 group 导入目录时自动检查 Git：目录已有 Git 就复用，没有就执行 `git init` 并建立初始提交；主工程师在项目根目录检查和合并，每个 worker 工程师都在独立 worktree / branch（`yah/...`）上工作，完成时自动提交自己的变更，报告里会列出使用的分支
- Manager 的工具权限被收窄为 `design_write`、`backlog_list`、`iteration_add`、`background_list`、`background_stop`；它不读文件、不搜索、不执行命令、不写代码，也不拆实现任务，所有执行和拆解都交给主工程师 / worker
- Manager 配置里可以设置工程师数量，默认 2、最少 2：内部编号 1 固定是主工程师，编号 2 是第一个 worker（显示「工程师 1」），这两个写死不能删除；编号 2 以后可以继续增加。调度器把设计案和 Finished 检查交给主工程师，把 Backlog 任务派给编号 2 及以后的空闲 worker，并按任务角色切换对应 worker profile
- 输入框底部从左到右是：当前 Agent 名字（如 `程序员`，琥珀色、左对齐，可点击展开暖色磨砂下拉菜单）、写死的模型名 `deepseek-v4.1-flash-1017`（带下拉箭头，目前只有这一个选项）、思考强度滑条、极简回车图标发送按钮；输入框默认不显示 placeholder。每个对话必须有一个 Agent，新对话默认使用「程序员」；按对话保存选择，新对话继承同项目上一个对话的 Agent；对话开始（有第一条消息）后 Agent 固定，选择器变灰锁定，不能再切换；排队消息会保存自己的 Agent
- 思考强度滑条是一条极简平面细线 + 小圆点，不显示「思考强度」文字和 low/high/max 挡位文字，鼠标指针保持默认；拖动时圆点自由跟随指针、没有吸附阈限，松开后自动吸附到最近的 `low` / `high` / `max` 挡位；也可以用方向键切换，选择保存在 `settings.json`，发送时作为 `reasoning_effort` 传给 DeepSeek
- 圆环外侧第一个位置是一个只读的 `usage` 圆角面板：显示 OpenCode Go 的 5 小时 / 本周 / 本月额度百分比和重置时间，不参与鼠标交互；数据由后端 `/api/usage` 获取并缓存 60 秒
- tool 和 Skill 面板是无标题的左右分栏：tool 页左侧按分类列出内置工具（搜索 / 文件 / 系统），代理类工具不在 tool 面板显示（仍可用于 Agent），右侧每个工具是一张独立卡片，默认折叠，只显示名称、参数数量和 chevron；点击展开说明和参数，一次最多只展开一个工具。Skill 页使用同样的分类侧栏和折叠卡片：左侧平铺系统、本地分类（内置 / 用户 / 绘画等，由 frontmatter `category` 决定）和 MCP 服务器（显示为 `MCP · 名称`），右侧每个 Skill 是一张和工具相同的卡片，默认折叠，展开后显示说明、固定指令和 MCP 参数；MCP 工具只出现在独立的 MCP 工作区，不混进 tool 面板；MCP 工作区左侧服务器、右侧概览 / 工具 / 资源 / 提示词 / 日志，概览是第一个 tab；没有内容时显示空状态
- Agent、tool、Skill、MCP 四个工作区共用一套字体层级：15px 标题、13.5px 条目名称、13px 正文、12px 紧凑说明、11px 次要信息和 10.5px 分组标签；侧栏、卡片圆角、悬停和选中态使用同一套样式
- 聊天里的 MCP 工具调用显示为「MCP 调用」，不会和内置工具的「工具调用」混在一起；调用参数和返回结果仍然合并在同一个卡片里；工具返回后右侧显示 `ok` / `error` 圆角标签，错误卡片带红色侧边和浅红背景，过程组标题会汇总错误数量
- 所有空状态（无对话、无消息、无工具/Skill/MCP、raw 为空、全文为空）统一在可用区域居中，颜色比正文淡一档
- 工具调用的 JSON 参数和 JSON 输出用带语法着色、可折叠节点的查看器展示
- Ctrl + 双击任意对话卡片可以查看该轮实际发给模型的原始请求 body，完整 JSON 树可逐层折叠
- 所有区域隐藏滚动条，滚轮/触控板仍然可以滚动
- 后端服务用 SQLite（`node:sqlite`，WAL）管理会话；设置和 API key 存 `settings.json`，窗口位置存 `window.json`
- MCP 服务器分两类：OpenCode 配置里的服务器自动继承（只读），以及 YAH 自己的 `%APPDATA%\yah\mcp.json` 自定义服务器；支持 STDIO、Streamable HTTP、legacy SSE，支持表单添加和粘贴 `mcpServers` / `mcp.servers` JSON
- OpenCode 中启用的 MCP 启动时自动连接，默认对所有对话开放；每个对话顶部的 MCP 摘要按钮可以单独开关服务器，关闭后请求里不再带该服务器的工具；OpenCode 中禁用的服务器会显示但不会连接；工具名统一为 `mcp__<server>__<tool>`
- MCP 工作区左侧是服务器列表（顶部没有标题和数字，「添加服务器」是列表最后一项，带 `+` 的虚线行，随列表一起滚动），右侧可以查看概览 / 工具 / 资源 / 提示词 / 日志，手动调用工具、读取资源、获取提示词；工具详情不再显示「插入到对话」和「复制调用名」，结果卡片仍可插入输入框；概览是默认打开的第一个 tab；没有服务器时空状态在整个内容区上下居中
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
server/subagents.js 子代理服务：新建/分叉只读对话、启动 run、完成后把结果排回父对话
server/system-nodes.js 系统 node 服务：调度器、Report Hub、审批、问卷、Agile 分发循环
server/git-worktrees.js Git 仓库初始化、专家 worktree 和分支、完成时提交
src/tools/tasks.js design_write / backlog_list / backlog_add / iteration_add / task_block / task_finish / task_merge / task_reject
server/skills.js   Skill 发现（skills/ + %APPDATA%\yah\skills）与 MCP prompts 转 Skill
server/agents.js   Agent 配置：固定内置角色列表，只读，不接受新增、删除或修改
src/agent-defaults.js 内置 Manager / Agent / Subagent 角色的 id、名称、提示词和工具权限
server/context.js  项目 AGENTS.md / agent.md 读取与一次性快照
skills/            内置 Skill Markdown（当前为空，系统 Skill 由 server/skills.js 提供）
server/mcp/config.js   MCP 自定义配置存储、JSON 配置解析
server/mcp/opencode.js OpenCode 配置发现与 MCP 服务器继承
server/mcp/transport.js STDIO / Streamable HTTP / legacy SSE 传输
server/mcp/client.js   MCP JSON-RPC 客户端、握手、能力缓存
server/mcp/manager.js  MCP 连接生命周期、自动重连、工具/资源/提示词调用
server/mcp/format.js   MCP 结果转纯文本
src/main.js        Electron 壳：窗口、拖动/缩放、全文窗口、拉起/连接后端
src/preload.js     只暴露窗口拖动/缩放和全文窗口能力
src/deepseek.js    OpenCode Go SSE + tool_calls 累积 + agent loop（后端）
src/tools.js       工具注册表：OpenCode + OMO 合并、MCP 路由、渲染标签
src/tools/         hashline、文件/搜索、shell/后台、任务/目标、子模型、web、agile、git 工具模块
src/tools/git.js   结构化 Git 工具（execFile + argv，禁用 shell 拼接；危险操作需 confirm）
src/tool-groups.js 工具目录分组（敏捷、Git、搜索、文件、系统等）
src/tools/guard.js 项目目录路径守卫：越界时暂停工具并等待人工审批
src/compaction.js  上下文压缩：OpenCode 阈值、checkpoint 模板、最近消息切分
src/goal.js        Goal 模式：目标归一化、审计问题、continue/complete/blocked 判定
src/reasoning.js   DeepSeek 思考强度：low / high / max 归一化
src/mcp-registry.js MCP 工具到 OpenAI function 的映射（后端）
src/store.js       chats.db（SQLite/WAL）+ settings.json 原子写 + 旧版迁移
src/renderer.js    网页客户端：聊天、项目工作区、设置、右键菜单、HTTP/SSE
src/mcp-ui.js      MCP 工作区：服务器、工具、资源、提示词、日志、概览
src/agile-store.js Agile 看板存储（agile.json）
src/agile-ui.js    Agile 看板页面：分组/迭代、五列、任务表单、设置
src/agile.html     独立 Agile 窗口页面
src/agile-window.js 独立 Agile 窗口：拖动、缩放、窗口按钮、轮询刷新
src/agile.css      Agile 看板样式
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
  - `system_nodes`：调度器、Report Hub、审批、问卷等非聊天 node
  - `events`：按会话递增的事件日志，用于 SSE 断线重连补发
  - `app_state`：当前会话 id 和标题序号
  - 运行时还会出现 `chats.db-wal` / `chats.db-shm`；备份时不要只复制 `chats.db`
- `%APPDATA%\yah\settings.json`：API key（后端读取，网页端拿不到）
- `%APPDATA%\yah\mcp.json`：YAH 自己添加的 MCP 服务器配置（STDIO 命令/参数/环境变量，或远程 URL/Headers）
- `%APPDATA%\yah\agents.json`：旧版 Agent 配置备份；当前 Agent 角色由代码固定，界面只读
- `%APPDATA%\yah\agile.json`：Agile 看板数据（分组、迭代、任务、备注、WIP、技能、事件日志），由任务工具和 Agile 页面共用
- `%APPDATA%\yah\agile-window.json`：独立 Agile 窗口的位置和大小
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

- OpenCode：`read`、`write`、`shell`、`webfetch`、`websearch`、`patch`、`question`、`systeminfo`
- Git（结构化、无 shell，统一放在工具的 Git 菜单）：`git_status`、`git_diff`、`git_log`、`git_show`、`git_blame`、`git_branch`、`git_checkout`、`git_add`、`git_commit`、`git_stash`、`git_fetch`、`git_pull`、`git_push`、`git_merge`、`git_remote`、`git_tag`、`git_restore`、`git_reset`、`git_revert`、`git_cherry_pick`、`worktree_*`
- OMO 优先：`glob`、`grep`、`edit`（LINE#ID hashline）
- OMO 常驻 / 条件工具：`background_start/list/stop`、`monitor_start/stop/list`
- 任务闭环：`design_write`（Manager 写入设计案）、`backlog_add`（主工程师拆解设计案）、`backlog_list`（查看设计案、任务、分支和检查状态）、`iteration_add`（新建迭代）、`task_block`（worker 或主工程师阻塞并创建审批或问卷）、`task_finish`（worker 提交结果 / 主工程师标记设计已拆解）、`task_merge`（主工程师合并 worker 分支并进入 Merged）、`task_reject`（主工程师打回 Finished 任务）
- 兼容别名：`hashline_edit`；`read_file`、`web_search`、`interactive_bash`、`SystemInfo`、`system_info` 只保留为旧调用的隐藏执行别名，不再作为工具暴露
- `read` 输出 `LINE#ID|content`；`edit` 用 LINE#ID 锚点批量修改，也支持 `path` + `oldString` + `newString`
- `background_*`、`monitor_*` 是按项目绑定的常驻服务管理：必须填写备注，只暴露运行 / 停止状态，不提供输出，也不会把完成结果送回对话；创建者或 Manager 可以停止。调度器只把 Backlog 任务分配给编号 2 及以后的 worker，主工程师保留给设计确认和合并检查；`interactive_bash` 已合并为 `shell` 的隐藏别名
- 独立 LLM Gateway：`llm-gateway/` 是一个不依赖 YAH Electron 的 Node 程序，导入 OpenChamber/OpenCode 使用的 models.dev 全量 provider 目录（326 个平台），用 OpenAI Chat、OpenAI Responses、Anthropic Messages、Gemini、Cohere、Azure OpenAI、Bedrock Converse 等适配器把各平台流式格式统一成 YAH canonical 事件（`start` / `text.delta` / `reasoning.delta` / `tool_call.*` / `usage` / `done`），通过 `POST /v1/chat` SSE 或 `POST /v1/chat/complete` 使用；详见 `llm-gateway/README.md`

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

`question` 让模型在任务中途提问：一次调用最多 5 个问题，每个问题可带选项（`multiple: true` 支持多选），前端会自动追加「其他（自己输入）」。支持两种模式：`blocking`（默认）会一直暂停，直到用户回答或关闭；`timed` 需要同时提供 `timeout_seconds`（5-600，默认 60），问题面板右上角显示倒计时环和剩余秒数，用户操作面板内任何控件都会重置倒计时，倒计时结束会自动提交当前已选 / 已填的内容（可能为空），工具返回「计时结束 / 未回答」并让模型按自己的判断继续。答案通过 `POST /api/questions/:id` 回传，倒计时重置通过 `POST /api/questions/:id/heartbeat` 延长服务端兜底计时；关闭面板会返回 `tool error: The user dismissed this question`。

`systeminfo` 快速返回精简的本地系统快照（纯文本）：日期、时间（含 UTC 偏移）、近似地理位置（时区城市）、操作系统、shell、项目工作目录及其读写边界警告（只允许读写工作目录内的文件，越界需要用户手动批准）和系统语言。全部本地读取，不联网；对话顶部的 `SYSTEMINFO` block 会自动调用它并展示结果。

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
