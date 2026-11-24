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
  'Execute a shell command and return stdout, stderr, and exit code. Supports workdir, timeout, and background mode. Background mode is a sustained project service and requires "note".',
  {
    command: str('Shell command string to execute'),
    workdir: str('Working directory'),
    timeout: num('Timeout in milliseconds (default 120000, 0 disables)'),
    background: bool('Start in the background and return a job id'),
    note: str('Required with background: true; a short note describing what the service does'),
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

const BACKGROUND_START = fn(
  'background_start',
  'Start a sustained project background service (dev server, watcher, npm run dev, a server that must stay up) and return immediately with its id, note and running state. It is not a way to run a task and get a result: no output or completion result is returned. Every call requires a short note. The service is listed in the manager project 后台 node; only its creator or a manager can stop it.',
  {
    command: str('Shell command to run'),
    note: str('Short note describing what this background service is for'),
    workdir: str('Working directory (defaults to the project directory)'),
  },
  ['command', 'note']
);
const BACKGROUND_LIST = fn(
  'background_list',
  "List the project's background services with id, running state, note, creator and command.",
  {}
);
const BACKGROUND_STOP = fn(
  'background_stop',
  'Stop a background service by id. Only its creator or a manager can stop it.',
  { id: str('Background service id') },
  ['id']
);
const MONITOR_START = fn(
  'monitor_start',
  'Start a sustained project background service and return its monitor id. Requires a short note.',
  {
    command: str('Command to run'),
    note: str('Short note describing what this background service is for'),
    workdir: str('Working directory'),
  },
  ['command', 'note']
);
const MONITOR_STOP = fn(
  'monitor_stop',
  'Stop a project background service.',
  { id: str('Monitor id') },
  ['id']
);
const MONITOR_LIST = fn('monitor_list', "List the project's background services.", {});

const HTML_VIEW = fn(
  'html_view',
  'Create an interactive HTML presentation and open it in a separate viewer window. HTML, CSS and JavaScript run, and forms, modals and same-origin assets are available. The page gets YAH cream typography by default and can use CSS variables such as --background, --surface-card, --text, --dim, --faint, --line, --accent, --accent-deep, --radius, --font and --mono.',
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
  'systeminfo',
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

const REPO_DIR = str('Repository directory; defaults to the project working directory');

const GIT_STATUS = fn(
  'git_status',
  'Show the repository state: branch, upstream, ahead/behind, staged, unstaged, untracked and conflicted files.',
  { repoDir: REPO_DIR }
);
const GIT_DIFF = fn(
  'git_diff',
  'Show changes as per-file insertion/deletion stats and an optional unified patch.',
  {
    repoDir: REPO_DIR,
    staged: bool('Show staged changes (git diff --cached)'),
    rev: str('Compare against a commit or range, for example HEAD~3 or main..HEAD'),
    paths: arr('Limit the diff to these pathspecs', { type: 'string' }),
    context: num('Unified context lines (default 3, max 50)'),
    patch: bool('Include the unified patch text (default true)'),
  }
);
const GIT_LOG = fn(
  'git_log',
  'Show commit history with hash, author, date, subject and body.',
  {
    repoDir: REPO_DIR,
    limit: num('Maximum commits (default 20, max 200)'),
    rev: str('Revision or range to walk (default HEAD)'),
    author: str('Only commits by this author'),
    since: str('Only commits after this date'),
    until: str('Only commits before this date'),
    grep: str('Only commits whose message matches this pattern'),
    path: str('Only commits touching this path'),
  }
);
const GIT_SHOW = fn(
  'git_show',
  'Show one commit: metadata, per-file stats and an optional patch.',
  {
    repoDir: REPO_DIR,
    rev: str('Commit, tag or revision (default HEAD)'),
    context: num('Unified context lines (default 3, max 50)'),
    patch: bool('Include the unified patch text (default true)'),
  }
);
const GIT_BLAME = fn(
  'git_blame',
  'Show which commit and author last changed each line of a file.',
  {
    repoDir: REPO_DIR,
    path: str('File path inside the repository'),
    rev: str('Revision to blame (default HEAD)'),
    startLine: num('First line (1-based)'),
    endLine: num('Last line (inclusive)'),
    maxLines: num('Maximum lines when endLine is omitted (default 200, max 1000)'),
  },
  ['path']
);
const GIT_BRANCH = fn(
  'git_branch',
  'Manage branches: list, create, delete or rename.',
  {
    repoDir: REPO_DIR,
    action: {
      type: 'string',
      enum: ['list', 'create', 'delete', 'rename'],
      description: 'Action (default list)',
    },
    name: str('Branch name'),
    newName: str('New branch name for rename'),
    startPoint: str('Commit or branch to start from when creating'),
    all: bool('Include remote-tracking branches when listing'),
    force: bool('Force delete an unmerged branch (still requires confirm)'),
    confirm: bool('Confirm deletion'),
  }
);
const GIT_CHECKOUT = fn(
  'git_checkout',
  'Switch to a branch, tag or commit. Set create=true to create and switch to a new branch.',
  {
    repoDir: REPO_DIR,
    target: str('Branch, tag or commit to check out'),
    create: bool('Create a new branch named target and switch to it'),
    startPoint: str('Commit or branch to start the new branch from'),
  },
  ['target']
);
const GIT_ADD = fn(
  'git_add',
  'Stage explicit paths, all changes, or tracked changes only.',
  {
    repoDir: REPO_DIR,
    paths: arr('Paths or pathspecs to stage', { type: 'string' }),
    all: bool('Stage all changes, including untracked files'),
    update: bool('Stage tracked changes only'),
  }
);
const GIT_COMMIT = fn(
  'git_commit',
  'Commit staged changes and return the commit hash and statistics. Amending requires confirm=true.',
  {
    repoDir: REPO_DIR,
    message: str('Commit message'),
    amend: bool('Amend the previous commit (requires confirm)'),
    allowEmpty: bool('Allow a commit with no staged changes'),
    confirm: bool('Confirm amending history'),
  },
  ['message']
);
const GIT_STASH = fn(
  'git_stash',
  'Manage stashes: list, push, pop, apply, drop, clear or show.',
  {
    repoDir: REPO_DIR,
    action: {
      type: 'string',
      enum: ['list', 'push', 'pop', 'apply', 'drop', 'clear', 'show'],
      description: 'Action (default list)',
    },
    message: str('Stash message for push'),
    paths: arr('Limit the stash to these paths', { type: 'string' }),
    index: num('Stash index (default 0)'),
    includeUntracked: bool('Include untracked files when pushing'),
    confirm: bool('Confirm drop or clear'),
  }
);
const GIT_FETCH = fn(
  'git_fetch',
  'Download refs from a remote without changing the working tree.',
  {
    repoDir: REPO_DIR,
    remote: str('Remote name'),
    branch: str('Remote branch to fetch'),
    all: bool('Fetch all remotes'),
    prune: bool('Prune deleted remote-tracking branches'),
    tags: bool('Fetch tags'),
  }
);
const GIT_PULL = fn(
  'git_pull',
  'Fetch and integrate remote changes. Fast-forward-only by default.',
  {
    repoDir: REPO_DIR,
    remote: str('Remote name'),
    branch: str('Remote branch to pull'),
    ffOnly: bool('Only allow fast-forward merges (default true)'),
  }
);
const GIT_PUSH = fn(
  'git_push',
  'Push the current branch to a remote. Force pushing is never allowed.',
  {
    repoDir: REPO_DIR,
    remote: str('Remote name'),
    branch: str('Branch to push'),
    setUpstream: bool('Set the upstream branch (requires remote and branch)'),
    tags: bool('Push tags'),
  }
);
const GIT_MERGE = fn(
  'git_merge',
  'Merge a branch, or abort or continue the current merge.',
  {
    repoDir: REPO_DIR,
    action: {
      type: 'string',
      enum: ['merge', 'abort', 'continue'],
      description: 'Action (default merge)',
    },
    branch: str('Branch to merge'),
    noFastForward: bool('Always create a merge commit'),
    message: str('Merge commit message'),
  }
);
const GIT_REMOTE = fn(
  'git_remote',
  'Manage remotes: list, add, remove, change URL or rename.',
  {
    repoDir: REPO_DIR,
    action: {
      type: 'string',
      enum: ['list', 'add', 'remove', 'setUrl', 'rename'],
      description: 'Action (default list)',
    },
    name: str('Remote name'),
    url: str('Remote URL'),
    newName: str('New remote name for rename'),
    confirm: bool('Confirm removal'),
  }
);
const GIT_TAG = fn(
  'git_tag',
  'Manage tags: list, create or delete.',
  {
    repoDir: REPO_DIR,
    action: {
      type: 'string',
      enum: ['list', 'create', 'delete'],
      description: 'Action (default list)',
    },
    name: str('Tag name'),
    message: str('Annotated tag message'),
    target: str('Commit or object to tag (default HEAD)'),
    confirm: bool('Confirm deletion'),
  }
);
const GIT_RESTORE = fn(
  'git_restore',
  'Restore files from a commit or the index. Discarding working tree changes requires confirm=true.',
  {
    repoDir: REPO_DIR,
    paths: arr('Paths to restore', { type: 'string' }),
    staged: bool('Restore the index instead of the working tree'),
    worktree: bool('Restore the working tree (default when staged is false)'),
    source: str('Source revision (default the index, or HEAD with staged)'),
    confirm: bool('Confirm discarding working tree changes'),
  },
  ['paths']
);
const GIT_RESET = fn(
  'git_reset',
  'Reset the current branch to a commit. Soft and mixed only move the branch or index; hard requires confirm=true.',
  {
    repoDir: REPO_DIR,
    mode: {
      type: 'string',
      enum: ['soft', 'mixed', 'hard'],
      description: 'Reset mode (default mixed)',
    },
    target: str('Commit to reset to (default HEAD)'),
    confirm: bool('Confirm a hard reset'),
  }
);
const GIT_REVERT = fn(
  'git_revert',
  'Revert commits by creating new commits, or abort or continue the current revert.',
  {
    repoDir: REPO_DIR,
    action: {
      type: 'string',
      enum: ['start', 'abort', 'continue'],
      description: 'Action (default start)',
    },
    commits: arr('Commits to revert', { type: 'string' }),
    noCommit: bool('Apply changes without creating a commit'),
    mainline: num('Parent number when reverting a merge commit'),
  }
);
const GIT_CHERRY_PICK = fn(
  'git_cherry_pick',
  'Cherry-pick commits onto the current branch, or abort or continue the current cherry-pick.',
  {
    repoDir: REPO_DIR,
    action: {
      type: 'string',
      enum: ['start', 'abort', 'continue'],
      description: 'Action (default start)',
    },
    commits: arr('Commits to cherry-pick', { type: 'string' }),
    noCommit: bool('Apply changes without creating a commit'),
    mainline: num('Parent number when cherry-picking a merge commit'),
  }
);

const GIT_TOOLS = [
  GIT_STATUS,
  GIT_DIFF,
  GIT_LOG,
  GIT_SHOW,
  GIT_BLAME,
  GIT_BRANCH,
  GIT_CHECKOUT,
  GIT_ADD,
  GIT_COMMIT,
  GIT_STASH,
  GIT_FETCH,
  GIT_PULL,
  GIT_PUSH,
  GIT_MERGE,
  GIT_REMOTE,
  GIT_TAG,
  GIT_RESTORE,
  GIT_RESET,
  GIT_REVERT,
  GIT_CHERRY_PICK,
  WORKTREE_LIST,
  WORKTREE_CREATE,
  WORKTREE_REMOVE,
];

const QUESTION = fn(
  'question',
  'Ask the user one or more questions and wait for answers. Use this when a decision or missing detail cannot be inferred safely. Up to five questions; options are optional.',
  {
    questions: arr('Questions to ask', {
      type: 'object',
      properties: {
        question: str('Complete question text'),
        header: str('Very short label'),
        options: arr('Available choices', {
          type: 'object',
          properties: {
            label: str('Display text'),
            description: str('Explanation of the choice'),
          },
          required: ['label'],
        }),
        multiple: bool('Allow selecting more than one choice'),
      },
      required: ['question', 'header'],
    }),
    mode: str('blocking (wait for the user) or timed'),
    timeoutSeconds: num('Timed mode timeout in seconds'),
  },
  ['questions']
);

const OPENCODE = [
  READ,
  WRITE,
  SHELL,
  WEBFETCH,
  WEBSEARCH,
  PATCH,
  SYSTEM_INFO,
  MOUSE,
  CODE_VIEW,
  PDF_VIEW,
  HTML_VIEW,
  CHROME,
  QUESTION,
];

const OMO = [
  GLOB,
  GREP,
  EDIT,
  BACKGROUND_START,
  BACKGROUND_LIST,
  BACKGROUND_STOP,
  MONITOR_START,
  MONITOR_STOP,
  MONITOR_LIST,
];

const TASK_TOOLS = [
  fn(
    'design_write',
    'Product manager (产品经理) only. First use question until the requirements of every task are fully clarified and confirmed. Then write the confirmed requirement list into the 需求清单 column. The orchestrator hands it to the architect (架构师) when the architect is idle. Include goal, scope, explicit requirements, constraints, non-goals, confirmed user answers, acceptance and open questions. Use designId to revise an existing requirement list.',
    {
      iterationId: str('Iteration id; omit to use or create the active iteration'),
      designId: str('Existing requirement list task id to revise; omit to create a new one'),
      title: str('Requirement list title'),
      goal: str('Mission goal / desired outcome'),
      description: str('Additional precise requirement context'),
      scope: str('Included scope and boundaries'),
      requirements: arr('Explicit user requirements', { type: 'string' }),
      constraints: arr('Technical or product constraints', { type: 'string' }),
      outOfScope: arr('Explicit non-goals', { type: 'string' }),
      answers: arr('Confirmed user answers from the question tool', {
        type: 'string',
      }),
      openQuestions: arr('Questions still open for the user', {
        type: 'string',
      }),
      acceptance: str('Definition of done and acceptance criteria'),
    },
    ['title']
  ),
  fn(
    'architecture_write',
    'Architect (架构师) only. Publish the technical architecture for the current requirement list before decomposing tasks. It is appended to the requirement card as a 技术方案 section, so requirements and technical design stay together.',
    {
      designId: str('Requirement list task id; defaults to the architect current requirement list'),
      summary: str('Architecture summary and chosen approach'),
      modules: arr('Modules, responsibilities and boundaries', { type: 'string' }),
      interfaces: arr('APIs, events, data contracts and call flows', {
        type: 'string',
      }),
      data: arr('Data model, storage and migration notes', { type: 'string' }),
      security: arr('Security, permissions and privacy notes', { type: 'string' }),
      performance: arr('Performance and scaling notes', { type: 'string' }),
      testStrategy: arr('Test strategy, environments and acceptance checks', {
        type: 'string',
      }),
      risks: arr('Risks, trade-offs and rollback plan', { type: 'string' }),
      alternatives: arr('Alternatives considered and why rejected', {
        type: 'string',
      }),
    },
    ['summary']
  ),
  fn(
    'backlog_list',
    'Product manager or architect. List the current iteration with requirement lists and every task, including column, assignee, review state, blocked reason, branches and result.',
    { iterationId: str('Iteration id; omit to use the active iteration') }
  ),
  fn(
    'backlog_add',
    'Architect (架构师) only. Decompose the requirement list into independent implementation tasks and add them to Backlog. Use dependsOn for real dependencies; keep tasks independently reviewable. Every task should include acceptance and a test plan.',
    {
      iterationId: str('Iteration id; omit to use the requirement iteration'),
      designId: str('Requirement list task id; defaults to the architect current requirement list'),
      goal: str('Mission goal used by the Report Hub'),
      tasks: arr('Backlog tasks', {
        type: 'object',
        properties: {
          title: str('Task title'),
          description: str('Task description and context'),
          role: str('Work role: research, programmer, tester, writer or reviewer'),
          acceptance: str('Acceptance criteria used by the architect review'),
          testPlan: str('What the tester should verify, with cases or commands'),
          dependsOn: arr('Task ids that must be merged first', {
            type: 'string',
          }),
        },
        required: ['title'],
      }),
    },
    ['tasks']
  ),
  fn(
    'iteration_add',
    'Product manager only. Create a new Agile iteration and return its id.',
    { goal: str('Iteration goal / mission name') }
  ),
  fn(
    'task_block',
    'Worker only. Block the current task and create an approval or questionnaire node. The node records which worker sent it. After the user resolves it, the orchestrator unblocks the task and resumes the same worker. Stop working after calling this.',
    {
      kind: str('approval or question'),
      reason: str('Why the task is blocked; shown on the task and the node'),
      action: str('Approval only: action or tool that needs approval'),
      path: str('Approval only: file or resource path'),
      questions: arr('Question only: questions to ask', {
        type: 'object',
        properties: {
          question: str('Complete question text'),
          header: str('Very short label'),
          options: arr('Available choices', {
            type: 'object',
            properties: {
              label: str('Display text'),
              description: str('Explanation of choice'),
            },
            required: ['label', 'description'],
          }),
          multiple: bool('Allow selecting more than one choice'),
        },
        required: ['question', 'header'],
      }),
      mode: str('Question only: blocking or timed'),
      timeoutSeconds: num('Question only: timed timeout in seconds'),
    },
    ['kind', 'reason']
  ),
  fn(
    'task_finish',
    'Worker or architect. Submit the result of the current task. Worker tasks are committed to their engineer branch and move to Testing for independent verification. Architect requirement tasks are marked ready after the requirement list has been decomposed.',
    {
      taskId: str('Task id; defaults to the current task'),
      summary: str('What was accomplished'),
      how: arr('Steps describing how the task was completed', { type: 'string' }),
      files: arr('Files created or changed', { type: 'string' }),
      commands: arr('Commands run', { type: 'string' }),
      tests: arr('Tests and outcomes', {
        type: 'object',
        properties: {
          name: str('Test name'),
          status: str('passed, failed or skipped'),
        },
      }),
      artifacts: arr('Artifacts such as screenshots, reports or URLs', { type: 'string' }),
      branches: arr('Git branches used by the worker', { type: 'string' }),
      blockers: arr('Blockers that remain', { type: 'string' }),
      followUps: arr('Suggested follow-up work', { type: 'string' }),
    },
    ['summary']
  ),
  fn(
    'test_report',
    'Tester only. Record independent verification for the task in Testing. Pass moves the task to Verified for the architect to merge; fail returns it to Backlog for the original engineer to rework.',
    {
      taskId: str('Task id; defaults to the current test task'),
      verdict: str('pass or fail'),
      summary: str('One-paragraph verdict in plain language'),
      cases: arr('Test cases and results', {
        type: 'object',
        properties: {
          name: str('Case name'),
          command: str('Command or manual step'),
          expected: str('Expected result'),
          actual: str('Actual result'),
          status: str('passed, failed or skipped'),
        },
      }),
      commands: arr('Commands run', { type: 'string' }),
      evidence: arr('Evidence such as logs, screenshots or URLs', {
        type: 'string',
      }),
      failures: arr('Failures and reproduction steps', { type: 'string' }),
      notes: str('Anything the architect or engineer should know'),
    },
    ['verdict', 'summary']
  ),
  fn(
    'task_merge',
    'Architect (架构师) only. Verify a Verified task, merge its implementation and test branches into the project branch, and move the task to Merged. Call once per verified task after checking the acceptance criteria and test report.',
    {
      taskId: str('Verified task id'),
      summary: str('Review summary written into the merge result'),
    },
    ['taskId']
  ),
  fn(
    'task_reject',
    'Architect (架构师) only. Reject a Verified task that does not meet the requirements or acceptance criteria. The task returns to Backlog with the review reason and is assigned again.',
    {
      taskId: str('Verified task id'),
      reason: str('What is incomplete or incorrect and must be reworked'),
    },
    ['taskId', 'reason']
  ),
  fn(
    'report_write',
    'Product manager only. Write the final plain-language report for the user after the mission is complete. Use short sections, concrete examples and before/after behavior. Keep file paths and commands out of the main narrative; put them in technicalDetails.',
    {
      title: str('Report title'),
      summary: str('One-paragraph answer to what happened'),
      requested: str('What the user originally asked for'),
      changes: arr('What now works, described for a non-technical reader', {
        type: 'string',
      }),
      examples: arr('Concrete usage examples or before/after examples', {
        type: 'string',
      }),
      howToTry: arr('Steps the user can follow to try it', { type: 'string' }),
      verification: arr('What was tested, in plain language', { type: 'string' }),
      notDone: arr('What is not done or still has risk', { type: 'string' }),
      nextSteps: arr('Suggested next steps', { type: 'string' }),
      technicalDetails: str('Optional technical details for engineers'),
    },
    ['summary']
  ),
];

function mergedDefinitions() {
  const byName = new Map();
  for (const definition of [...OPENCODE, ...OMO, ...TASK_TOOLS, ...GIT_TOOLS]) {
    byName.set(definition.function.name, definition);
  }
  return [...byName.values()];
}

module.exports = {
  mergedDefinitions,
  OPENCODE,
  OMO,
  TASK_TOOLS,
  GIT_TOOLS,
};
