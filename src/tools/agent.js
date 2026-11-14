'use strict';

const fs = require('node:fs');
const path = require('node:path');
const store = require('../store');
const { guardPath } = require('./guard');

let providers = {
  skillService: null,
  mcpManager: null,
};

function configure(next = {}) {
  providers = { ...providers, ...next };
}

function apiKey() {
  return String(
    process.env.OPENCODE_API_KEY || store.loadSettings().apiKey || ''
  ).trim();
}

async function subagentTool(args) {
  const prompt = String(args.prompt || args.description || '').trim();
  if (!prompt) return 'tool error: subagent requires "prompt"';
  const key = apiKey();
  if (!key) return 'tool error: no API key configured';
  const label = String(args.agent || args.subagent_type || 'general');
  try {
    const deepseek = require('../deepseek');
    const text = await deepseek.runSubagent({
      apiKey: key,
      system: `You are the "${label}" subagent. Complete the task and return a concise result. Do not ask questions.`,
      prompt,
    });
    return text || '(subagent returned no text)';
  } catch (error) {
    return `tool error: subagent failed: ${error.message}`;
  }
}

async function lookAtTool(args, context = null) {
  const raw = String(args.path || '').trim();
  if (!raw) return 'tool error: look_at requires "path"';
  const abs = path.resolve(raw);
  await guardPath(abs, context, { tool: 'look_at' });
  const stat = await fs.promises.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) return `tool error: image not found: ${raw}`;
  if (stat.size > 10 * 1024 * 1024) return 'tool error: image is larger than 10 MB';
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/png';
  const key = apiKey();
  if (!key) return 'tool error: no API key configured';
  const data = await fs.promises.readFile(abs);
  try {
    const deepseek = require('../deepseek');
    const text = await deepseek.runVisionSubagent({
      apiKey: key,
      prompt: String(args.prompt || 'Describe this image in detail.'),
      imageUrl: `data:${mime};base64,${data.toString('base64')}`,
    });
    return text || '(no description)';
  } catch (error) {
    return `tool error: look_at failed: ${error.message}`;
  }
}

function normalizeQuestions(args) {
  const raw = Array.isArray(args?.questions) ? args.questions : [];
  const questions = [];
  for (const item of raw.slice(0, 5)) {
    const source = typeof item === 'string' ? { question: item } : item;
    if (!source || typeof source !== 'object') continue;
    const question = String(source.question || '').trim();
    if (!question) continue;
    const header =
      String(source.header || '').trim().slice(0, 30) ||
      question.slice(0, 30);
    const options = [];
    if (Array.isArray(source.options)) {
      for (const option of source.options.slice(0, 12)) {
        const label = String(option?.label || '').trim();
        if (!label) continue;
        options.push({
          label: label.slice(0, 120),
          description: String(option?.description || '').trim().slice(0, 300),
        });
      }
    }
    questions.push({
      question,
      header,
      options,
      multiple: source.multiple === true,
    });
  }
  if (questions.length === 0) {
    throw new Error('question requires at least one question');
  }
  return questions;
}

function normalizeQuestionMode(value) {
  return String(value || '').trim().toLowerCase() === 'timed'
    ? 'timed'
    : 'blocking';
}

function normalizeQuestionTimeout(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  return Math.max(5, Math.min(600, Math.round(seconds)));
}

async function questionTool(args, context = null) {
  const questions = normalizeQuestions(args);
  if (typeof context?.askQuestions !== 'function') {
    return 'tool error: interactive questions are not available in this client';
  }
  const requestedTimeout = Number(
    args?.timeout_seconds ?? args?.timeoutSeconds
  );
  const mode = normalizeQuestionMode(
    args?.mode || (requestedTimeout > 0 ? 'timed' : 'blocking')
  );
  const timeoutSeconds =
    mode === 'timed'
      ? normalizeQuestionTimeout(args?.timeout_seconds ?? args?.timeoutSeconds)
      : 0;
  const result = await context.askQuestions(questions, {
    mode,
    timeoutSeconds,
  });
  if (result?.cancelled === true) {
    throw new Error('The user dismissed this question');
  }
  const answers = Array.isArray(result) ? result : result?.answers;
  const formatted = questions
    .map((question, index) => {
      const values = Array.isArray(answers?.[index])
        ? answers[index].map(String).filter(Boolean)
        : [];
      return `"${question.question}"="${
        values.length ? values.join(', ') : 'Unanswered'
      }"`;
    })
    .join(', ');
  if (result?.timedOut === true) {
    const timeout = Number(result?.timeoutSeconds) || timeoutSeconds;
    const answered = questions.some((question, index) =>
      Array.isArray(answers?.[index]) && answers[index].length > 0
    );
    if (!answered) {
      return timeout > 0
        ? `The user did not answer within ${timeout} seconds. No answer was provided. Continue with your best judgment.`
        : 'The question timer expired with no answer. Continue with your best judgment.';
    }
    return timeout > 0
      ? `The ${timeout}-second question timer expired. Answers entered so far: ${formatted}. Continue with your best judgment for unanswered questions.`
      : `The question timer expired. Answers entered so far: ${formatted}. Continue with your best judgment for unanswered questions.`;
  }
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
}

function sessionRename(args) {
  const chats = store.loadChats();
  const id = String(args.sessionID || '').trim();
  const session = id
    ? chats.sessions.find((item) => item.id === id)
    : chats.sessions[chats.current];
  if (!session) return 'tool error: session not found';
  const title = String(args.title || '').trim();
  if (!title) return 'tool error: title is required';
  session.title = title;
  store.saveStructure(chats);
  return `Renamed ${session.id} to "${title}"`;
}

function modelsTool(args) {
  const models = [
    {
      id: 'opencode-go/deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash 1017',
      provider: 'opencode-go',
      context: 1_000_000,
      maxTokens: 384_000,
    },
  ];
  const query = String(args.query || '').toLowerCase();
  const provider = String(args.provider || '').toLowerCase();
  const filtered = models.filter(
    (model) =>
      (!query || `${model.id} ${model.name}`.toLowerCase().includes(query)) &&
      (!provider || model.provider.toLowerCase().includes(provider))
  );
  return JSON.stringify({ models: filtered, total: filtered.length }, null, 2);
}

async function skillTool(args) {
  const service = providers.skillService;
  if (!service) return 'tool error: skill service is not configured';
  const name = String(args.name || '').trim();
  if (!name) return 'tool error: skill requires "name"';
  const chats = store.loadChats();
  const session = args.sessionID
    ? chats.sessions.find((item) => item.id === args.sessionID)
    : chats.sessions[chats.current];
  const disabled = Array.isArray(session?.mcpDisabled)
    ? session.mcpDisabled
    : [];
  const skills = service.list({ mcpDisabled: disabled });
  const needle = name.replace(/^\//, '').toLowerCase();
  const match =
    skills.find((skill) => skill.id.toLowerCase() === needle) ||
    skills.find((skill) => skill.name.toLowerCase() === needle) ||
    skills.find((skill) => skill.name.toLowerCase().includes(needle)) ||
    skills.find((skill) => skill.id.toLowerCase().includes(needle));
  if (!match) {
    return `tool error: skill "${name}" not found. Available: ${skills
      .map((skill) => skill.name)
      .join(', ')}`;
  }
  try {
    const result = await service.resolveMany(
      [{ id: match.id, arguments: args.arguments || {} }],
      disabled
    );
    return result.text || '(empty skill)';
  } catch (error) {
    return `tool error: ${error.message}`;
  }
}

function resolveServerId(manager, value) {
  const key = String(value || '').trim();
  if (!key) return '';
  const server = manager.allServers().find(
    (item) => item.id === key || item.name === key
  );
  return server ? server.id : key;
}

async function skillMcpTool(args) {
  const manager = providers.mcpManager;
  if (!manager) return 'tool error: MCP manager is not configured';
  const server = resolveServerId(manager, args.server);
  const tool = String(args.tool || '').trim();
  if (server && tool) {
    try {
      const result = await manager.callTool(
        server,
        tool,
        args.arguments && typeof args.arguments === 'object'
          ? args.arguments
          : {}
      );
      return result.text || JSON.stringify(result);
    } catch (error) {
      return `tool error: ${error.message}`;
    }
  }
  const tools = manager.toolList();
  return tools.length
    ? tools
        .map(
          (entry) =>
            `${entry.serverName}  ${entry.tool.name}  ${entry.tool.description || ''}`
        )
        .join('\n')
    : 'No MCP tools connected.';
}

function listMcpResources() {
  const manager = providers.mcpManager;
  if (!manager) return 'tool error: MCP manager is not configured';
  const resources =
    typeof manager.resourceList === 'function' ? manager.resourceList() : [];
  return resources.length
    ? resources
        .map(
          (entry) =>
            `${entry.serverName}  ${entry.resource.uri}  ${
              entry.resource.name || entry.resource.description || ''
            }`
        )
        .join('\n')
    : 'No MCP resources connected.';
}

async function readMcpResource(args) {
  const manager = providers.mcpManager;
  if (!manager) return 'tool error: MCP manager is not configured';
  const server = resolveServerId(manager, args.server);
  const uri = String(args.uri || '').trim();
  if (!server || !uri) return 'tool error: read_mcp_resource requires server and uri';
  try {
    const result = await manager.readResource(server, uri);
    return result.text || JSON.stringify(result);
  } catch (error) {
    return `tool error: ${error.message}`;
  }
}

function gitWorktrees() {
  return new Promise((resolve) => {
    const { spawn } = require('node:child_process');
    const child = spawn('git', ['worktree', 'list', '--porcelain'], {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString()));
    child.stderr.on('data', (chunk) => (error += chunk.toString()));
    child.on('close', (code) =>
      resolve(code === 0 ? { ok: true, output } : { ok: false, error })
    );
  });
}

async function worktreeList() {
  const result = await gitWorktrees();
  if (!result.ok) return `tool error: ${result.error.trim() || 'git worktree failed'}`;
  const worktrees = result.output
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const dir = lines.find((line) => line.startsWith('worktree '));
      const branch = lines.find((line) => line.startsWith('branch '));
      return dir
        ? {
            directory: dir.slice('worktree '.length),
            branch: branch ? branch.slice('branch '.length) : '',
          }
        : null;
    })
    .filter(Boolean);
  return JSON.stringify({ worktrees }, null, 2);
}

async function worktreeCreate(args) {
  const name = String(args.name || '').trim();
  if (!name) return 'tool error: name is required';
  const target = path.resolve(process.cwd(), '..', name);
  const { spawn } = require('node:child_process');
  return new Promise((resolve) => {
    const child = spawn('git', ['worktree', 'add', target, '-b', name], {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let error = '';
    child.stderr.on('data', (chunk) => (error += chunk.toString()));
    child.on('close', (code) =>
      resolve(
        code === 0
          ? `Created worktree in ${target}`
          : `tool error: ${error.trim() || 'git worktree add failed'}`
      )
    );
  });
}

async function worktreeRemove(args) {
  const directory = String(args.directory || '').trim();
  if (!directory) return 'tool error: directory is required';
  const { spawn } = require('node:child_process');
  const argv = ['worktree', 'remove'];
  if (args.force === true) argv.push('--force');
  argv.push(directory);
  return new Promise((resolve) => {
    const child = spawn('git', argv, { cwd: process.cwd(), windowsHide: true });
    let error = '';
    child.stderr.on('data', (chunk) => (error += chunk.toString()));
    child.on('close', (code) =>
      resolve(
        code === 0
          ? `Removed worktree ${directory}`
          : `tool error: ${error.trim() || 'git worktree remove failed'}`
      )
    );
  });
}

module.exports = {
  configure,
  subagentTool,
  lookAtTool,
  questionTool,
  normalizeQuestions,
  sessionRename,
  modelsTool,
  skillTool,
  skillMcpTool,
  listMcpResources,
  readMcpResource,
  worktreeList,
  worktreeCreate,
  worktreeRemove,
};
