'use strict';

// Merged tool catalog: OpenCode built-ins + oh-my-opencode (OMO) tools.
// For overlapping names OMO wins (glob, grep, edit, skill), per OMO's registry.

function fn(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
      },
    },
  };
}

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const obj = (description) => ({ type: 'object', description });
const arr = (description, items) => ({
  type: 'array',
  description,
  ...(items ? { items } : {}),
});

const READ = fn(
  'read',
  'Read a text file or directory. Text lines are prefixed with LINE#ID|content for hashline edits. Use offset and limit for large files.',
  {
    path: str('File or directory to read'),
    offset: num('1-based line or directory entry to start from'),
    limit: num('Maximum lines or entries (default 2000)'),
  },
  ['path']
);

const WRITE = fn(
  'write',
  'Write a UTF-8 text file, creating parent directories as needed.',
  {
    path: str('Absolute path, or a path relative to the working directory'),
    content: str('Content to write to the file'),
  },
  ['path', 'content']
);

const EDIT = fn(
  'edit',
  'Edit files using LINE#ID anchors from read output for precise, safe modifications. ' +
    'Each read line is "LINE#ID|content". Copy tags exactly. One call can batch edits for one file; ' +
    'all anchors reference the original file state and are applied bottom-up. ' +
    'replace removes pos..end and inserts lines; append/prepend insert after/before an anchor; ' +
    'no anchors mean EOF/BOF. lines:null or [] deletes with replace. ' +
    'For simple edits, path + oldString + newString also works.',
  {
    filePath: str('Absolute path to the file to edit'),
    delete: bool('Delete the file instead of editing'),
    rename: str('Rename the file after edits'),
    edits: arr('Hashline edit operations', {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['replace', 'append', 'prepend'] },
        pos: str('Primary anchor in LINE#ID format'),
        end: str('Range end anchor in LINE#ID format'),
        lines: {
          anyOf: [arr('Replacement lines'), str('Newline-delimited replacement text'), { type: 'null' }],
        },
      },
      required: ['op', 'lines'],
    }),
    path: str('Simple-edit path (legacy)'),
    oldString: str('Exact text to find (simple edit)'),
    newString: str('Replacement text (simple edit)'),
    replaceAll: bool('Replace all occurrences (simple edit)'),
  }
);

const GLOB = fn(
  'glob',
  'Fast file pattern matching tool with safety limits (60s timeout, 100 file limit). ' +
    'Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
  {
    pattern: str('The glob pattern to match files against'),
    path: str('Directory to search in; defaults to the working directory'),
    hidden: bool('Include hidden files and directories'),
    limit: num('Maximum number of files (default 100)'),
  },
  ['pattern']
);

const GREP = fn(
  'grep',
  'Fast content search tool with safety limits (60s timeout, 256KB output). ' +
    'Searches file contents using regular expressions. Filter files with include (e.g. "*.js", "*.{ts,tsx}"). ' +
    'Output modes: content, files_with_matches (default), count.',
  {
    pattern: str('The regex pattern to search for in file contents'),
    include: str('File pattern to include (e.g. "*.js")'),
    path: str('Directory to search; defaults to the working directory'),
    output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
    head_limit: num('Limit output to the first N entries; 0 means no limit'),
  },
  ['pattern']
);

const SHELL = fn(
  'shell',
  'Execute a shell command and return stdout, stderr, and exit code. Supports workdir, timeout, and background mode.',
  {
    command: str('Shell command string to execute'),
    workdir: str('Working directory'),
    timeout: num('Timeout in milliseconds (default 120000, 0 disables)'),
    background: bool('Start in the background and return a job id'),
  },
  ['command']
);

const WEBFETCH = fn(
  'webfetch',
  'Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.',
  {
    url: str('The HTTP or HTTPS URL to fetch'),
    format: { type: 'string', enum: ['text', 'markdown', 'html'] },
    timeout: num('Timeout in seconds (1-120, default 30)'),
  },
  ['url']
);

const WEBSEARCH = fn(
  'websearch',
  'Search the public web with DuckDuckGo. Use for current events, facts you are unsure about, or anything beyond training data.',
  {
    query: str("Search query, in the user's language if appropriate"),
    max_results: num('How many results to return (1-8)'),
  },
  ['query']
);

const PATCH = fn(
  'patch',
  'Apply a unified diff patch to the working tree using git apply.',
  { patchText: str('The full patch text describing add, update, and delete operations') },
  ['patchText']
);

const SKILL = fn(
  'skill',
  'Load a Skill by name and return its instructions. Use without leading slash. Skills may come from files or MCP prompts.',
  {
    name: str("The skill name (e.g. 'test-skill' or 'Character Design')"),
    arguments: obj('Optional MCP Skill arguments'),
    sessionID: str('Optional session id; defaults to the current session'),
  },
  ['name']
);

const SKILL_MCP = fn(
  'skill_mcp',
  'List MCP tools, or call one MCP tool by server and tool name.',
  {
    server: str('MCP server id or name'),
    tool: str('MCP tool name'),
    arguments: obj('Tool arguments'),
  }
);

const SESSION_LIST = fn('session_list', 'List YAH sessions with id, title, and message count.', {});
const SESSION_READ = fn(
  'session_read',
  'Read messages from a YAH session. Omit sessionID for the current session.',
  {
    sessionID: str('Session id'),
    offset: num('0-based message offset'),
    limit: num('Maximum messages (default 30, max 100)'),
  }
);
const SESSION_SEARCH = fn(
  'session_search',
  'Search message text across YAH sessions.',
  { query: str('Text to search for'), sessionID: str('Optional session id') },
  ['query']
);
const SESSION_INFO = fn(
  'session_info',
  'Show metadata for a YAH session: project, message count, MCP switches, fold state, queue.',
  { sessionID: str('Session id') }
);

const TASK_CREATE = fn(
  'task_create',
  'Create a task in the local YAH task list.',
  {
    subject: str('Short task subject'),
    description: str('Task details'),
    status: str('pending | in_progress | completed | cancelled'),
    priority: str('low | medium | high'),
    depends_on: arr('Task ids that must complete first', { type: 'string' }),
  },
  ['subject']
);
const TASK_GET = fn('task_get', 'Get a local task by id.', { id: str('Task id') }, ['id']);
const TASK_LIST = fn(
  'task_list',
  'List local tasks, optionally filtered by status.',
  { status: str('Filter by status') }
);
const TASK_UPDATE = fn(
  'task_update',
  'Update a local task.',
  {
    id: str('Task id'),
    subject: str('New subject'),
    description: str('New description'),
    status: str('New status'),
    priority: str('New priority'),
    depends_on: arr('New dependency ids', { type: 'string' }),
  },
  ['id']
);

const BACKGROUND_START = fn(
  'background_start',
  'Start a long-running background process (dev server, watcher, npm run dev, a server that must stay up) and return immediately with its id, note and startup info. The process keeps running so it can keep serving; it is not a way to run a task and get a result. Use subagent_start for tasks whose result should come back to the conversation. Manage it with background_list, background_output and background_stop.',
  {
    command: str('Shell command to run'),
    note: str('Short note describing what this background task is doing'),
    workdir: str('Working directory (defaults to the project directory)'),
    timeout_seconds: num(
      'Optional timeout in seconds; omit or use 0 for no timeout'
    ),
  },
  ['command', 'note']
);
const BACKGROUND_LIST = fn(
  'background_list',
  'List all background tasks in the current conversation with id, status, elapsed time, note and command.',
  {}
);
const BACKGROUND_STOP = fn(
  'background_stop',
  'Stop a running background task by id.',
  { id: str('Background task id') },
  ['id']
);
const BACKGROUND_OUTPUT = fn(
  'background_output',
  'Read output and status of a background job.',
  { id: str('Background job id') },
  ['id']
);
const BACKGROUND_CANCEL = fn(
  'background_cancel',
  'Cancel a background job by id.',
  { id: str('Background job id') },
  ['id']
);
const MONITOR_START = fn(
  'monitor_start',
  'Start a background command and return its monitor id.',
  {
    command: str('Command to run'),
    workdir: str('Working directory'),
    timeout: num('Timeout in milliseconds'),
  },
  ['command']
);
const MONITOR_STOP = fn(
  'monitor_stop',
  'Stop a monitored background command.',
  { id: str('Monitor id') },
  ['id']
);
const MONITOR_LIST = fn('monitor_list', 'List monitored background commands.', {});
const MONITOR_OUTPUT = fn(
  'monitor_output',
  'Read output from a monitored background command.',
  { id: str('Monitor id') },
  ['id']
);

const AGILE_LIST_GROUPS = fn(
  'agile_list_groups',
  'List agile groups and their iterations. The five columns are fixed: backlog, human, progress, blocked, finished.',
  {}
);
const AGILE_CREATE_GROUP = fn(
  'agile_create_group',
  'Create a named group that can hold agile iterations.',
  { name: str('Group name') },
  ['name']
);
const AGILE_RENAME_GROUP = fn(
  'agile_rename_group',
  'Rename an agile group.',
  { groupId: str('Group id'), name: str('New group name') },
  ['groupId', 'name']
);
const AGILE_DELETE_GROUP = fn(
  'agile_delete_group',
  'Delete a group and all iterations and tasks inside it.',
  { groupId: str('Group id') },
  ['groupId']
);
const AGILE_LIST_BOARDS = fn(
  'agile_list_boards',
  'List all agile iterations with task counts and dates.',
  {}
);
const AGILE_GET_BOARD = fn(
  'agile_get_board',
  'Get an agile iteration with columns, tasks and settings.',
  { boardId: str('Iteration id (defaults to the active iteration)') }
);
const AGILE_CREATE_BOARD = fn(
  'agile_create_board',
  'Create a new blank iteration inside a group. The iteration is numbered automatically.',
  { groupId: str('Group id (defaults to the last group)') }
);
const AGILE_UPDATE_BOARD = fn(
  'agile_update_board',
  'Set an iteration start date, end date and goal.',
  {
    boardId: str('Iteration id'),
    startDate: str('Start date (YYYY-MM-DD)'),
    endDate: str('End date (YYYY-MM-DD)'),
    goal: str('Iteration goal'),
  },
  ['boardId']
);
const AGILE_DELETE_BOARD = fn(
  'agile_delete_board',
  'Delete an iteration and its tasks.',
  { boardId: str('Iteration id') },
  ['boardId']
);
const AGILE_ASSIGN_BOARD_TO_GROUP = fn(
  'agile_assign_board_to_group',
  'Move an iteration into another group. It becomes the last iteration of that group.',
  { boardId: str('Iteration id'), groupId: str('Target group id') },
  ['boardId', 'groupId']
);
const AGILE_LIST_TASKS = fn(
  'agile_list_tasks',
  'List tasks in an iteration, optionally filtered by column, search, claimedBy, needsDigest or ready.',
  {
    boardId: str('Iteration id (defaults to the active iteration)'),
    column: str('Column id or name'),
    search: str('Text to search in title and description'),
    claimedBy: str('Exact agent id; empty string selects unclaimed tasks'),
    needsDigest: bool('Only tasks with (or without) undigested notes'),
    ready: bool('Only ready tasks (Backlog/Human, notes digested, unclaimed)'),
  }
);
const AGILE_GET_TASK = fn(
  'agile_get_task',
  'Get one task with description, notes, claim state, blocked reason and column history.',
  { taskId: str('Task id') },
  ['taskId']
);
const AGILE_CREATE_TASK = fn(
  'agile_create_task',
  'Create a task in Backlog. The human owns notes (keyPoints); this tool cannot add notes. Call agile_digest_notes after folding notes into the description before claiming or moving into In Progress.',
  {
    title: str('Task title'),
    description: str('Task description'),
    assignee: str('Optional assignee'),
    boardId: str('Iteration id (defaults to the active iteration)'),
    agent: str('Calling agent identity'),
  },
  ['title']
);
const AGILE_CREATE_TASKS = fn(
  'agile_create_tasks',
  'Create several Backlog tasks in one call. Every item lands in Backlog.',
  {
    boardId: str('Iteration id (defaults to the active iteration)'),
    tasks: arr('Tasks to create', {
      type: 'object',
      properties: {
        title: str('Task title'),
        description: str('Task description'),
        assignee: str('Optional assignee'),
      },
      required: ['title'],
    }),
    agent: str('Calling agent identity'),
  },
  ['tasks']
);
const AGILE_UPDATE_TASK = fn(
  'agile_update_task',
  'Update a task title, description, assignee or blocked reason. This cannot change notes or clear needsDigest.',
  {
    taskId: str('Task id'),
    title: str('New title'),
    description: str('New description'),
    assignee: str('New assignee'),
    blockedReason: str('Blocked reason; empty string clears it'),
    agent: str('Calling agent identity'),
  },
  ['taskId']
);
const AGILE_MOVE_TASK = fn(
  'agile_move_task',
  'Move a task to one of the five fixed columns. Moving into In Progress is refused while the task has undigested notes; an unclaimed task moved there is claimed by the caller.',
  {
    taskId: str('Task id'),
    column: str('Column id or name: backlog, human, progress, blocked, finished'),
    position: num('0-based position in the target column (default appends)'),
    agent: str('Calling agent identity'),
  },
  ['taskId', 'column']
);
const AGILE_MOVE_TASKS = fn(
  'agile_move_tasks',
  'Move several tasks into one of the five fixed columns. Refused per task while it has undigested notes (In Progress), and unclaimed tasks moved there are claimed by the caller.',
  {
    taskIds: arr('Task ids to move', { type: 'string' }),
    column: str('Column id or name: backlog, human, progress, blocked, finished'),
    position: num('0-based position in the target column (default appends)'),
    agent: str('Calling agent identity'),
  },
  ['taskIds', 'column']
);
const AGILE_DELETE_TASK = fn(
  'agile_delete_task',
  'Delete a task. Finished tasks cannot be deleted.',
  { taskId: str('Task id'), agent: str('Calling agent identity') },
  ['taskId']
);
const AGILE_SET_BLOCKED_REASON = fn(
  'agile_set_blocked_reason',
  'Record why a task is blocked, or clear the reason with an empty string.',
  {
    taskId: str('Task id'),
    reason: str('Blocked reason; empty string clears it'),
    agent: str('Calling agent identity'),
  },
  ['taskId']
);
const AGILE_CLAIM_TASK = fn(
  'agile_claim_task',
  'Claim a task for an agent. Refused while it has undigested human notes or another live claim.',
  { taskId: str('Task id'), agent: str('Agent identity') },
  ['taskId']
);
const AGILE_RELEASE_TASK = fn(
  'agile_release_task',
  'Release a claimed task.',
  { taskId: str('Task id'), agent: str('Agent identity') },
  ['taskId']
);
const AGILE_HEARTBEAT_TASK = fn(
  'agile_heartbeat_task',
  'Keep a claimed In Progress task alive without changing its content.',
  { taskId: str('Task id'), agent: str('Agent identity') },
  ['taskId']
);
const AGILE_CLAIM_NEXT = fn(
  'agile_claim_next',
  'Claim the next ready task (Backlog before Human In The Loop, notes digested, unclaimed or expired).',
  { boardId: str('Iteration id'), agent: str('Agent identity') }
);
const AGILE_DIGEST_NOTES = fn(
  'agile_digest_notes',
  'Fold the human notes into the description by stamping digestedAt and clearing needsDigest. This is the only way to clear it.',
  {
    taskId: str('Task id'),
    pointIds: arr('Specific note ids; omit to digest all undigested notes', {
      type: 'string',
    }),
    agent: str('Calling agent identity'),
  },
  ['taskId']
);
const AGILE_UNDIGEST_NOTES = fn(
  'agile_undigest_notes',
  'Reverse digesting by removing digestedAt stamps and setting needsDigest again.',
  {
    taskId: str('Task id'),
    pointIds: arr('Specific note ids; omit to undigest every digested note', {
      type: 'string',
    }),
    agent: str('Calling agent identity'),
  },
  ['taskId']
);
const AGILE_LIST_COLUMNS = fn(
  'agile_list_columns',
  'List the five fixed agile columns and their WIP limits.',
  {}
);
const AGILE_GET_BOARD_SNAPSHOT = fn(
  'agile_get_board_snapshot',
  'Get the full projected board snapshot (board, columns, tasks, settings, seq).',
  { boardId: str('Iteration id') }
);
const AGILE_GET_SETTINGS = fn(
  'agile_get_settings',
  'Get per-iteration settings.',
  { boardId: str('Iteration id') }
);
const AGILE_UPDATE_SETTINGS = fn(
  'agile_update_settings',
  'Merge fields into per-iteration settings (showChangeDate, locale, wipLimits).',
  {
    boardId: str('Iteration id'),
    fields: obj('Fields to merge'),
  },
  ['fields']
);
const AGILE_LIST_EVENTS = fn(
  'agile_list_events',
  'List recent agile domain events (audit trail), oldest first.',
  { limit: num('Maximum events (1-1000)') }
);
const AGILE_WAIT_FOR_EVENT = fn(
  'agile_wait_for_event',
  'Wait for the next agile event after a sequence number (max 30s). Returns timedOut when nothing arrives.',
  {
    since: num('Return the first event with seq greater than this value'),
    timeoutMs: num('Maximum wait in milliseconds (1-30000, default 15000)'),
    type: str('Only this event type'),
    boardId: str('Only this iteration id'),
  }
);
const AGILE_LIST_ROADMAP = fn(
  'agile_list_roadmap',
  'List groups and iterations with dates, goals and unfinished task counts.',
  {}
);
const AGILE_LIST_SKILLS = fn(
  'agile_list_skills',
  'List the agile collaboration skills / usage guides.',
  {}
);
const AGILE_GET_SKILL = fn(
  'agile_get_skill',
  'Get one agile skill by id or name.',
  { skill: str('Skill id or name') },
  ['skill']
);
const AGILE_CREATE_SKILL = fn(
  'agile_create_skill',
  'Create an agile collaboration skill.',
  {
    name: str('Skill name'),
    description: str('Short description'),
    content: str('Usage guide text'),
  },
  ['name']
);
const AGILE_UPDATE_SKILL = fn(
  'agile_update_skill',
  'Update an agile skill.',
  {
    skillId: str('Skill id'),
    name: str('New name'),
    description: str('New description'),
    content: str('New content'),
  },
  ['skillId']
);
const AGILE_DELETE_SKILL = fn(
  'agile_delete_skill',
  'Delete an agile skill.',
  { skillId: str('Skill id') },
  ['skillId']
);
const INTERACTIVE_BASH = fn(
  'interactive_bash',
  'Run a shell command (interactive tmux sessions are not available on Windows; this runs a normal shell command).',
  {
    command: str('Command to run'),
    workdir: str('Working directory'),
    timeout: num('Timeout in milliseconds'),
  },
  ['command']
);

const TASK = fn(
  'task',
  'Quick one-shot subagent: runs one model request without tools and returns a concise result synchronously. Use subagent_start for a full subagent conversation with tools, a read-only transcript, and a result queued back into this conversation.',
  {
    description: str('A short 3-5 word description of the task'),
    prompt: str('The task for the subagent to perform'),
    subagent_type: str('Agent label (e.g. general, explore)'),
    model: str('Optional model id'),
    background: bool('Run in the background (currently synchronous)'),
  },
  ['description', 'prompt']
);
const SUBAGENT = fn(
  'subagent',
  'Quick one-shot subagent. Alias of task; use subagent_start for a full read-only subagent conversation with tools.',
  {
    agent: str('Agent label'),
    description: str('A short 3-5 word label for the task'),
    prompt: str('The task for the subagent to perform'),
    model: str('Optional model id'),
    sessionID: str('Optional session id'),
    background: bool('Run in the background (currently synchronous)'),
  },
  ['agent', 'description', 'prompt']
);
const CALL_OMO_AGENT = fn(
  'call_omo_agent',
  'Call an OMO-style subagent with a prompt. Alias of task.',
  {
    description: str('A short description of the task'),
    prompt: str('The task for the subagent'),
    subagent_type: str('Agent label'),
    model: str('Optional model id'),
    background: bool('Run in the background (currently synchronous)'),
  },
  ['description', 'prompt']
);
const DELEGATE_TASK = fn(
  'delegate_task',
  'Delegate a task to a subagent. Alias of task.',
  {
    description: str('A short description of the task'),
    prompt: str('The task for the subagent'),
    subagent_type: str('Agent label'),
    model: str('Optional model id'),
    background: bool('Run in the background (currently synchronous)'),
  },
  ['description', 'prompt']
);

const SUBAGENT_START = fn(
  'subagent_start',
  'Start a subagent in its own read-only conversation and return immediately. The subagent runs the full agent loop with tools; when it finishes, its result is queued back into this conversation as a follow-up prompt. Use fork=true to copy the current conversation into the subagent first; otherwise it starts a fresh conversation. Use this for tasks whose result should come back here. Use background_start for long-running processes that should keep running.',
  {
    prompt: str('The task for the subagent'),
    name: str('Short name for the subagent conversation'),
    fork: bool('Fork the current conversation into the subagent conversation'),
    agent: str('Agent id or label for the subagent'),
    note: str('Short note shown in the result'),
  },
  ['prompt']
);
const SUBAGENT_LIST = fn(
  'subagent_list',
  'List subagent conversations with their status and result preview.',
  {}
);
const SUBAGENT_OUTPUT = fn(
  'subagent_output',
  'Read a subagent conversation’s final result and status.',
  { sessionId: str('Subagent session id') },
  ['sessionId']
);
const SUBAGENT_STOP = fn(
  'subagent_stop',
  'Stop a running subagent.',
  { sessionId: str('Subagent session id') },
  ['sessionId']
);

const CREATE_GOAL = fn(
  'create_goal',
  'Create a local goal with an objective.',
  { objective: str('Goal objective'), status: str('active | completed | cancelled'), progress: str('Progress note') },
  ['objective']
);
const UPDATE_GOAL = fn(
  'update_goal',
  'Update a local goal.',
  { id: str('Goal id'), objective: str('New objective'), status: str('New status'), progress: str('New progress') },
  ['id']
);
const GET_GOAL = fn('get_goal', 'Get the latest goal, or a goal by id.', { id: str('Goal id') });

const LIST_MCP_RESOURCES = fn('list_mcp_resources', 'List resources exposed by connected MCP servers.', {});
const READ_MCP_RESOURCE = fn(
  'read_mcp_resource',
  'Read an MCP resource by server and URI.',
  { server: str('MCP server id or name'), uri: str('Resource URI') },
  ['server', 'uri']
);

const QUESTION = fn(
  'question',
  `Ask the user up to 5 questions when you need a decision, preference, or clarification. A question sheet rises from the bottom of the chat; the user can pick an option, select several options, or type their own answer. Use this instead of guessing or asking in prose when the answer changes what you do next.

Modes:
- "blocking" (default): the run waits until the user answers or dismisses the question.
- "timed": set "timeout_seconds" (5-600, default 60). The sheet shows a countdown; any user interaction resets it. When it expires, the answers entered so far (possibly none) are submitted automatically, and you should continue with your best judgment for anything unanswered.

Usage notes:
- Ask at most 5 questions per call. Ask several independent questions together instead of making several calls.
- A "write your own answer" input is added automatically; do not add a separate free-form option.
- Set "multiple": true to allow selecting more than one option.
- If you recommend an option, put it first and end its label with "(Recommended)".
- Keep "header" to a very short label (max 30 characters).
- Omit "options" or use an empty array when the answer should be free-form text.
- Use "timed" when you can proceed without the user; use "blocking" when the answer is required before any further work.`,
  {
    questions: arr('Questions to ask (1-5)', {
      type: 'object',
      properties: {
        question: str('Complete question text'),
        header: str('Very short label (max 30 chars)'),
        options: arr('Available choices. Omit or leave empty for a free-form answer.', {
          type: 'object',
          properties: {
            label: str('Display text (1-5 words, concise)'),
            description: str('Explanation of choice'),
          },
          required: ['label', 'description'],
        }),
        multiple: bool('Allow selecting multiple choices'),
      },
      required: ['question', 'header'],
    }),
    mode: str(
      '"blocking" waits for the user; "timed" auto-submits after timeout_seconds'
    ),
    timeout_seconds: num(
      'Timed mode only: seconds before auto-submit (5-600, default 60)'
    ),
  },
  ['questions']
);
QUESTION.function.parameters.properties.questions.minItems = 1;
QUESTION.function.parameters.properties.questions.maxItems = 5;
QUESTION.function.parameters.properties.mode.enum = ['blocking', 'timed'];
QUESTION.function.parameters.properties.timeout_seconds.minimum = 5;
QUESTION.function.parameters.properties.timeout_seconds.maximum = 600;

const LOOK_AT = fn(
  'look_at',
  'Inspect an image with the multimodal model and return a description.',
  { path: str('Image path'), prompt: str('What to look for') },
  ['path']
);

const SESSION_RENAME = fn(
  'session_rename',
  'Rename a YAH session. Omit sessionID to rename the current session.',
  { sessionID: str('Session id'), title: str('New session title') },
  ['title']
);
const MODELS = fn(
  'models',
  'Search available models.',
  { query: str('Text to search in model names and ids'), provider: str('Provider filter'), limit: num('Max results') }
);
const HTML_VIEW = fn(
  'html_view',
  'Create a standalone HTML presentation and open it in a separate viewer window. Use HTML and CSS only; scripts are disabled. The page gets YAH cream typography by default and can use CSS variables such as --background, --surface-card, --text, --dim, --faint, --line, --accent, --accent-deep, --radius, --font and --mono.',
  {
    html: str('HTML document or fragment to display'),
    title: str('Window title; the same title reuses the same window'),
  },
  ['html']
);
const PDF_VIEW = fn(
  'pdf_view',
  'Open a separate PDF viewer window for a local PDF file. Optionally jump to a page and highlight a search query.',
  {
    path: str('PDF file path'),
    page: num('Page number to focus (1-based)'),
    query: str('Text to highlight on the page'),
    title: str('Window title'),
  },
  ['path']
);
const CODE_VIEW = fn(
  'code_view',
  'Open a separate code viewer window for a local text file. Optionally focus and highlight a line range.',
  {
    path: str('Code file path'),
    line: num('First line to focus (1-based)'),
    end_line: num('Last line to focus'),
    title: str('Window title'),
  },
  ['path']
);
const MOUSE = fn(
  'mouse',
  'Control the real Windows mouse. Coordinates are physical screen pixels. Use position to read the cursor, move to place it, click or double-click, drag from one point to another, and scroll. This operates the actual desktop, not a browser page.',
  {
    action: {
      type: 'string',
      enum: ['position', 'move', 'click', 'drag', 'scroll'],
      description: 'What to do with the mouse',
    },
    x: num('Screen X for move, click or drag start'),
    y: num('Screen Y for move, click or drag start'),
    to_x: num('Drag end X'),
    to_y: num('Drag end Y'),
    button: {
      type: 'string',
      enum: ['left', 'right', 'middle'],
      description: 'Click button (default left)',
    },
    count: num('Click count, 1-3 (default 1)'),
    duration_ms: num('Drag duration in milliseconds (default 350)'),
    delta: num('Wheel delta; positive scrolls up, negative down (default 120)'),
  },
  ['action']
);
const CHROME = fn(
  'chrome',
  'Control a real Chrome or Edge window over the DevTools Protocol, without Playwright. ' +
    'Use launch/open to start a visible Chrome with a dedicated profile and remote debugging, then ' +
    'tabs, activate, read, screenshot, click, type, press, eval, wait, console, network, devtools, ' +
    'navigate, back, forward, reload, stop, close and status. ' +
    'read extracts visible text, HTML, headings, links or form fields; click and type use real input events; ' +
    'console and network show what the page is doing; devtools opens the DevTools frontend for the active tab. ' +
    'Coordinates for click are CSS pixels in the page viewport. Chrome is visible by default; headless is optional.',
  {
    action: {
      type: 'string',
      enum: [
        'launch',
        'open',
        'tabs',
        'activate',
        'read',
        'screenshot',
        'click',
        'type',
        'press',
        'eval',
        'wait',
        'console',
        'network',
        'devtools',
        'navigate',
        'back',
        'forward',
        'reload',
        'stop',
        'close',
        'status',
      ],
      description: 'What to do',
    },
    url: str('URL to open or navigate to; accepts http(s), file, localhost:port or a bare domain'),
    tabId: str('Target tab id, id prefix, URL fragment or title fragment; defaults to the active tab'),
    selector: str('CSS selector for read, click, type, screenshot or wait'),
    text: str('Text to type, or text to wait for'),
    expression: str('JavaScript expression for eval'),
    x: num('Viewport X for click when no selector is given'),
    y: num('Viewport Y for click when no selector is given'),
    button: {
      type: 'string',
      enum: ['left', 'right', 'middle'],
      description: 'Mouse button for click (default left)',
    },
    clickCount: num('Click count 1-3 (default 1)'),
    key: str(
      'Key for press: Enter, Tab, Escape, Backspace, Delete, arrows, PageUp, PageDown, Home, End, Space, F5, F12 or a single character'
    ),
    modifiers: arr('Modifier keys for press, e.g. ["ctrl","shift"]', { type: 'string' }),
    mode: {
      type: 'string',
      enum: ['text', 'html', 'summary', 'links', 'forms'],
      description: 'What read returns (default text)',
    },
    maxChars: num('Maximum characters returned by read or eval'),
    format: {
      type: 'string',
      enum: ['png', 'jpeg'],
      description: 'Screenshot format (default png)',
    },
    quality: num('JPEG quality 1-100 (default 82)'),
    fullPage: bool('Capture the full scrollable page'),
    path: str('Screenshot output path; defaults to a temp file'),
    timeoutMs: num('Wait timeout for open, navigate or wait (default 10000 or 5000)'),
    waitFor: {
      type: 'string',
      enum: ['selector', 'text', 'url'],
      description: 'What wait should wait for',
    },
    state: {
      type: 'string',
      enum: ['attached', 'visible', 'hidden'],
      description: 'Selector state for wait (default visible)',
    },
    level: {
      type: 'string',
      enum: ['all', 'error', 'warning', 'info', 'log'],
      description: 'Console level filter',
    },
    limit: num('Maximum console entries or network requests (default 50, max 200)'),
    filter: str('Only network requests whose URL contains this text'),
    clear: bool('Clear captured console/network entries after reading, or clear the field before typing'),
    target: {
      type: 'string',
      enum: ['tab', 'browser'],
      description: 'What close should close (default tab)',
    },
    newWindow: bool('Open a new window instead of a new tab'),
    devtools: bool('Open DevTools for the active tab, or auto-open them when launching'),
    headless: bool('Launch Chrome headless (default false; visible Chrome is easier to debug)'),
    port: num('Remote debugging port; defaults to 9222 or the next free port'),
    profile: str('Chrome profile directory or short profile name; defaults to YAH chrome-profile'),
    channel: {
      type: 'string',
      enum: ['chrome', 'edge'],
      description: 'Browser to launch (default chrome)',
    },
    width: num('Launch window width'),
    height: num('Launch window height'),
    waitForLoad: bool('Wait for document readyState complete after open (default true)'),
    ignoreCache: bool('Reload with a cache bypass'),
    awaitPromise: bool('Await promises returned by eval (default true)'),
    waitMs: num('Milliseconds to wait after click, type or press'),
    submit: bool('Press Enter after typing'),
  },
  ['action']
);
const SYSTEM_INFO = fn(
  'SystemInfo',
  'Get a compact local system snapshot as plain text: date, time, approximate location, OS, shell, project working directory with its access rule, and system language. No network.',
  {}
);
const WORKTREE_LIST = fn('worktree_list', "List the current git repository's worktrees.", {});
const WORKTREE_CREATE = fn(
  'worktree_create',
  'Create a named git worktree next to the repository.',
  { name: str('Worktree name') },
  ['name']
);
const WORKTREE_REMOVE = fn(
  'worktree_remove',
  'Remove a git worktree.',
  { directory: str('Absolute worktree path'), force: bool('Discard modified/untracked files') },
  ['directory']
);

const TEAM_CREATE = fn(
  'team_create',
  'Create a local team record with optional members.',
  {
    name: str('Team name'),
    members: arr('Members', {
      type: 'object',
      properties: { name: str('Member name'), role: str('Member role') },
      required: ['name'],
    }),
  },
  ['name']
);
const TEAM_DELETE = fn('team_delete', 'Delete a local team record.', { name: str('Team name') }, ['name']);
const TEAM_LIST = fn('team_list', 'List local team records.', {});
const TEAM_STATUS = fn('team_status', 'Show a local team record.', { name: str('Team name') }, ['name']);
const TEAM_SEND_MESSAGE = fn(
  'team_send_message',
  'Append a message to a local team mailbox.',
  { team: str('Team name'), from: str('Sender'), to: str('Recipient'), message: str('Message') },
  ['team', 'message']
);
const TEAM_TASK_CREATE = fn(
  'team_task_create',
  'Create a task in a local team record.',
  { team: str('Team name'), subject: str('Subject'), description: str('Details'), assignee: str('Assignee') },
  ['team', 'subject']
);
const TEAM_TASK_LIST = fn('team_task_list', 'List tasks in a local team record.', { team: str('Team name') }, ['team']);
const TEAM_TASK_UPDATE = fn(
  'team_task_update',
  'Update a task in a local team record.',
  {
    team: str('Team name'),
    id: str('Task id'),
    subject: str('New subject'),
    description: str('New details'),
    assignee: str('New assignee'),
    status: str('New status'),
  },
  ['team', 'id']
);
const TEAM_TASK_GET = fn(
  'team_task_get',
  'Get a task from a local team record.',
  { team: str('Team name'), id: str('Task id') },
  ['team', 'id']
);
const TEAM_SHUTDOWN_REQUEST = fn(
  'team_shutdown_request',
  'Mark a local team member as shutdown-requested.',
  { team: str('Team name'), member: str('Member name or id') },
  ['team', 'member']
);
const TEAM_APPROVE_SHUTDOWN = fn(
  'team_approve_shutdown',
  'Mark a local team member as shut down.',
  { team: str('Team name'), member: str('Member name or id') },
  ['team', 'member']
);
const TEAM_REJECT_SHUTDOWN = fn(
  'team_reject_shutdown',
  'Return a local team member to active status.',
  { team: str('Team name'), member: str('Member name or id') },
  ['team', 'member']
);

const OPENCODE = [
  READ,
  WRITE,
  SHELL,
  WEBFETCH,
  WEBSEARCH,
  PATCH,
  SESSION_RENAME,
  MODELS,
  SYSTEM_INFO,
  MOUSE,
  CODE_VIEW,
  PDF_VIEW,
  HTML_VIEW,
  CHROME,
  WORKTREE_LIST,
  WORKTREE_CREATE,
  WORKTREE_REMOVE,
  QUESTION,
  SUBAGENT,
  LIST_MCP_RESOURCES,
  READ_MCP_RESOURCE,
];

const OMO = [
  GLOB,
  GREP,
  EDIT,
  SKILL,
  SKILL_MCP,
  SESSION_LIST,
  SESSION_READ,
  SESSION_SEARCH,
  SESSION_INFO,
  TASK_CREATE,
  TASK_GET,
  TASK_LIST,
  TASK_UPDATE,
  BACKGROUND_START,
  BACKGROUND_LIST,
  BACKGROUND_STOP,
  BACKGROUND_OUTPUT,
  BACKGROUND_CANCEL,
  AGILE_LIST_GROUPS,
  AGILE_CREATE_GROUP,
  AGILE_RENAME_GROUP,
  AGILE_DELETE_GROUP,
  AGILE_LIST_BOARDS,
  AGILE_GET_BOARD,
  AGILE_CREATE_BOARD,
  AGILE_UPDATE_BOARD,
  AGILE_DELETE_BOARD,
  AGILE_ASSIGN_BOARD_TO_GROUP,
  AGILE_LIST_TASKS,
  AGILE_GET_TASK,
  AGILE_CREATE_TASK,
  AGILE_CREATE_TASKS,
  AGILE_UPDATE_TASK,
  AGILE_MOVE_TASK,
  AGILE_MOVE_TASKS,
  AGILE_DELETE_TASK,
  AGILE_SET_BLOCKED_REASON,
  AGILE_CLAIM_TASK,
  AGILE_RELEASE_TASK,
  AGILE_HEARTBEAT_TASK,
  AGILE_CLAIM_NEXT,
  AGILE_DIGEST_NOTES,
  AGILE_UNDIGEST_NOTES,
  AGILE_LIST_COLUMNS,
  AGILE_GET_BOARD_SNAPSHOT,
  AGILE_GET_SETTINGS,
  AGILE_UPDATE_SETTINGS,
  AGILE_LIST_EVENTS,
  AGILE_WAIT_FOR_EVENT,
  AGILE_LIST_ROADMAP,
  AGILE_LIST_SKILLS,
  AGILE_GET_SKILL,
  AGILE_CREATE_SKILL,
  AGILE_UPDATE_SKILL,
  AGILE_DELETE_SKILL,
  MONITOR_START,
  MONITOR_STOP,
  MONITOR_LIST,
  MONITOR_OUTPUT,
  INTERACTIVE_BASH,
  TASK,
  CALL_OMO_AGENT,
  DELEGATE_TASK,
  SUBAGENT_START,
  SUBAGENT_LIST,
  SUBAGENT_OUTPUT,
  SUBAGENT_STOP,
  CREATE_GOAL,
  UPDATE_GOAL,
  GET_GOAL,
  LOOK_AT,
  TEAM_CREATE,
  TEAM_DELETE,
  TEAM_LIST,
  TEAM_STATUS,
  TEAM_SEND_MESSAGE,
  TEAM_TASK_CREATE,
  TEAM_TASK_LIST,
  TEAM_TASK_UPDATE,
  TEAM_TASK_GET,
  TEAM_SHUTDOWN_REQUEST,
  TEAM_APPROVE_SHUTDOWN,
  TEAM_REJECT_SHUTDOWN,
];

const WORKNODE_TOOLS = [
  fn(
    'worknode_options',
    'List the Agents, tools, skills and MCP servers that can be assigned to a work node. Use this before creating work nodes.',
    {}
  ),
  fn(
    'worknode_list',
    'List the work nodes owned by this manager node, with Agent, task, status and last output preview.',
    { includeArchived: bool('Include archived work nodes') }
  ),
  fn(
    'worknode_create',
    'Create a work node conversation under this manager node. Choose an Agent, give it a concrete task, and optionally narrow its tools, skills or MCP servers. Set start=false to create it idle.',
    {
      title: str('Short work node title'),
      task: str('Task prompt for the work node'),
      agentId: str('Agent id chosen from worknode_options'),
      tools: arr('Optional subset of the Agent tools'),
      skills: arr('Optional subset of skill ids'),
      mcp: arr('Optional subset of MCP server ids'),
      start: bool('Start the task immediately (default true)'),
    },
    ['title', 'agentId', 'task']
  ),
  fn(
    'worknode_adopt',
    'Attach an existing conversation node to this manager as a work node. The conversation keeps its messages; use worknode_update to change its Agent or task afterward.',
    {
      id: str('Existing root conversation id from worknode_options.availableWorknodes'),
    },
    ['id']
  ),
  fn(
    'worknode_update',
    'Update a work node assignment. Only works while it is not running. Values must stay within the chosen Agent permissions.',
    {
      id: str('Work node id'),
      agentId: str('New Agent id'),
      task: str('New task prompt'),
      tools: arr('New tool subset'),
      skills: arr('New skill subset'),
      mcp: arr('New MCP server subset'),
    },
    ['id']
  ),
  fn(
    'worknode_start',
    'Start a work node with its task, or with a new task prompt. The node must be idle.',
    {
      id: str('Work node id'),
      task: str('Optional task prompt to use instead of the stored task'),
    },
    ['id']
  ),
  fn(
    'worknode_status',
    'Check status, current run, task and last output for one work node, or all work nodes when id is omitted.',
    { id: str('Optional work node id') }
  ),
  fn(
    'worknode_read',
    'Read recent messages from a work node.',
    {
      id: str('Work node id'),
      offset: num('0-based message offset'),
      limit: num('Maximum messages (default 20, max 60)'),
    },
    ['id']
  ),
  fn(
    'worknode_message',
    'Send a follow-up prompt to a work node. It must be idle.',
    {
      id: str('Work node id'),
      text: str('Follow-up prompt'),
    },
    ['id', 'text']
  ),
  fn(
    'worknode_stop',
    'Stop the running work node, or every running work node under this manager when id is omitted.',
    { id: str('Optional work node id') }
  ),
  fn(
    'team_layout',
    'Arrange all work nodes under this manager into a tidy grid on the canvas.',
    {}
  ),
];

const LEGACY = [
  fn(
    'read_file',
    'Alias of read: read a UTF-8 text file with numbered lines.',
    {
      path: str('Absolute path or path relative to the working directory'),
      offset: num('1-based line number to start from'),
      limit: num('Maximum lines (1-2000)'),
    },
    ['path']
  ),
];

function mergedDefinitions() {
  const byName = new Map();
  for (const definition of [...LEGACY, ...OPENCODE, ...OMO, ...WORKNODE_TOOLS]) {
    byName.set(definition.function.name, definition);
  }
  return [...byName.values()];
}

module.exports = {
  mergedDefinitions,
  OPENCODE,
  OMO,
  LEGACY,
  WORKNODE_TOOLS,
};
