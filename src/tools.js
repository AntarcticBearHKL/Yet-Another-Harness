'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const mcp = require('./mcp-registry');
const { mergedDefinitions } = require('./tools/definitions');
const files = require('./tools/files');
const processTools = require('./tools/process');
const stateTools = require('./tools/state');
const agentTools = require('./tools/agent');
const webTools = require('./tools/web');

function configure(next = {}) {
  agentTools.configure(next);
}

// 免费 web_search：DuckDuckGo 公开 HTML 端点，不需要 API key。
// 解析 result__a / result__snippet，把 uddg= 重定向解成真实 URL。

const SEARCH_URL = 'https://html.duckduckgo.com/html/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

function definitions(options = {}) {
  return [
    ...mergedDefinitions(),
    ...mcp.definitions({ disabledServerIds: options.mcpDisabled }),
  ];
}

async function execute(name, args) {
  let value;
  try {
    value = JSON.parse(args || '{}');
  } catch (error) {
    return `tool error: invalid JSON arguments: ${error.message}`;
  }
  if (!value || typeof value !== 'object') value = {};

  try {
    if (name === 'web_search' || name === 'websearch') {
      const query = String(value.query ?? '').trim();
      if (!query) {
        return `tool error: ${name} requires a non-empty "query"`;
      }
      const max = Math.max(1, Math.min(8, Number(value.max_results) || 5));
      return await webSearch(query, max);
    }

    if (name === 'read_file') {
      return await readFileTool(value);
    }

    const handlers = {
      read: files.readTool,
      write: files.writeTool,
      edit: files.editTool,
      hashline_edit: files.editTool,
      glob: files.globTool,
      grep: files.grepTool,
      patch: files.patchTool,
      shell: processTools.shellTool,
      interactive_bash: processTools.shellTool,
      webfetch: webTools.webfetchTool,
      skill: agentTools.skillTool,
      skill_mcp: agentTools.skillMcpTool,
      session_list: stateTools.sessionList,
      session_read: stateTools.sessionRead,
      session_search: stateTools.sessionSearch,
      session_info: stateTools.sessionInfo,
      session_rename: agentTools.sessionRename,
      task_create: stateTools.taskCreate,
      task_get: stateTools.taskGet,
      task_list: stateTools.taskList,
      task_update: stateTools.taskUpdate,
      create_goal: stateTools.createGoal,
      update_goal: stateTools.updateGoal,
      get_goal: stateTools.getGoal,
      background_output: processTools.backgroundOutput,
      background_cancel: processTools.backgroundCancel,
      monitor_start: processTools.monitorStart,
      monitor_stop: processTools.monitorStop,
      monitor_list: processTools.monitorList,
      monitor_output: processTools.monitorOutput,
      task: agentTools.subagentTool,
      subagent: agentTools.subagentTool,
      call_omo_agent: agentTools.subagentTool,
      delegate_task: agentTools.subagentTool,
      look_at: agentTools.lookAtTool,
      question: agentTools.questionTool,
      models: agentTools.modelsTool,
      worktree_list: agentTools.worktreeList,
      worktree_create: agentTools.worktreeCreate,
      worktree_remove: agentTools.worktreeRemove,
      list_mcp_resources: agentTools.listMcpResources,
      read_mcp_resource: agentTools.readMcpResource,
      team_create: stateTools.teamCreate,
      team_delete: stateTools.teamDelete,
      team_list: stateTools.teamList,
      team_status: stateTools.teamStatus,
      team_send_message: stateTools.teamSendMessage,
      team_task_create: stateTools.teamTaskCreate,
      team_task_list: stateTools.teamTaskList,
      team_task_update: stateTools.teamTaskUpdate,
      team_task_get: stateTools.teamTaskGet,
      team_shutdown_request: stateTools.teamShutdownRequest,
      team_approve_shutdown: stateTools.teamApproveShutdown,
      team_reject_shutdown: stateTools.teamRejectShutdown,
    };
    const handler = handlers[name];
    if (handler) return await handler(value);
    if (mcp.isMcpTool(name)) return mcp.execute(name, args);
    return `tool error: unknown tool "${name}"`;
  } catch (error) {
    return `tool error: ${error.message}`;
  }
}

function statusLabel(name, args) {
  let value = {};
  try {
    value = JSON.parse(args || '{}');
  } catch {
    /* ignore */
  }
  if (name === 'web_search' || name === 'websearch') {
    const query = Array.from(String(value.query ?? '')).slice(0, 48).join('');
    return `${name}: ${query}`;
  }
  if (name === 'read' || name === 'read_file' || name === 'write') {
    const filePath = String(value.path ?? '');
    const base = filePath ? path.basename(filePath) : '';
    return base ? `${name}: ${base}` : name;
  }
  if (name === 'edit' || name === 'hashline_edit') {
    const filePath = String(value.filePath || value.path || '');
    return filePath ? `edit: ${path.basename(filePath)}` : 'edit';
  }
  if (name === 'glob' || name === 'grep') {
    const pattern = String(value.pattern ?? '');
    return pattern ? `${name}: ${pattern}` : name;
  }
  if (name === 'shell' || name === 'interactive_bash') {
    const command = String(value.command ?? '').replace(/\s+/g, ' ').slice(0, 60);
    return command ? `${name}: ${command}` : name;
  }
  if (name === 'webfetch') {
    try {
      return `webfetch: ${new URL(String(value.url ?? '')).host}`;
    } catch {
      return 'webfetch';
    }
  }
  if (name === 'skill') {
    return value.name ? `skill: ${value.name}` : 'skill';
  }
  if (name === 'task' || name === 'subagent' || name === 'call_omo_agent' || name === 'delegate_task') {
    return value.description ? `${name}: ${value.description}` : name;
  }
  if (name === 'patch') return 'patch';
  if (name === 'skill_mcp') {
    const parts = [value.server, value.tool].filter(Boolean);
    return parts.length ? `skill_mcp: ${parts.join('/')}` : 'skill_mcp';
  }
  if (name === 'look_at') {
    const filePath = String(value.path ?? '');
    return filePath ? `look_at: ${path.basename(filePath)}` : 'look_at';
  }
  if (name === 'session_list') return 'session_list';
  if (name === 'session_read' || name === 'session_info' || name === 'session_rename') {
    return value.sessionID ? `${name}: ${value.sessionID}` : name;
  }
  if (name === 'session_search') {
    const query = String(value.query ?? '').slice(0, 40);
    return query ? `session_search: ${query}` : 'session_search';
  }
  if (name === 'task_create' || name === 'task_get' || name === 'task_update') {
    const label = value.subject || value.id;
    return label ? `${name}: ${label}` : name;
  }
  if (name === 'task_list') return value.status ? `task_list: ${value.status}` : 'task_list';
  if (name === 'create_goal') {
    const objective = String(value.objective ?? '').slice(0, 48);
    return objective ? `create_goal: ${objective}` : 'create_goal';
  }
  if (name === 'update_goal' || name === 'get_goal') {
    return value.id ? `${name}: ${value.id}` : name;
  }
  if (name === 'team_create' || name === 'team_delete' || name === 'team_status') {
    return value.name ? `${name}: ${value.name}` : name;
  }
  if (name.startsWith('team_')) {
    const team = value.team || value.name;
    return team ? `${name}: ${team}` : name;
  }
  if (name.startsWith('background_') || name.startsWith('monitor_')) {
    const label = value.id || value.command;
    return label ? `${name}: ${String(label).slice(0, 40)}` : name;
  }
  if (name === 'question') {
    const first = Array.isArray(value.questions) ? value.questions[0] : null;
    const text = String(first?.question || first || '').slice(0, 48);
    return text ? `question: ${text}` : 'question';
  }
  if (name === 'models') {
    return value.query ? `models: ${value.query}` : 'models';
  }
  if (name === 'worktree_create') {
    return value.name ? `worktree_create: ${value.name}` : 'worktree_create';
  }
  if (name === 'worktree_remove') {
    const dir = String(value.directory ?? '');
    return dir ? `worktree_remove: ${path.basename(dir)}` : 'worktree_remove';
  }
  if (name === 'worktree_list') return 'worktree_list';
  if (name === 'list_mcp_resources') return 'list_mcp_resources';
  if (name === 'read_mcp_resource') {
    const parts = [value.server, value.uri].filter(Boolean);
    return parts.length ? `read_mcp_resource: ${parts.join(' ')}` : 'read_mcp_resource';
  }
  if (mcp.isMcpTool(name)) {
    return mcp.statusLabel(name, args);
  }
  return `tool: ${name}`;
}

async function readFileTool(value) {
  const rawPath = String(value.path ?? '').trim();
  if (!rawPath) {
    return 'tool error: read_file requires a non-empty "path"';
  }
  const abs = path.resolve(rawPath);
  const offset = Math.max(1, Number(value.offset) || 1);
  const limit = Math.max(1, Math.min(2000, Number(value.limit) || 200));

  let stat;
  try {
    stat = await fs.promises.stat(abs);
  } catch (error) {
    return `tool error: cannot read "${rawPath}": ${error.code || error.message}`;
  }
  if (!stat.isFile()) {
    return `tool error: "${rawPath}" is not a file`;
  }

  try {
    const handle = await fs.promises.open(abs, 'r');
    try {
      const sample = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      if (sample.subarray(0, bytesRead).includes(0)) {
        return `tool error: "${rawPath}" looks like a binary file`;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    return `tool error: cannot read "${rawPath}": ${error.code || error.message}`;
  }

  const stream = fs.createReadStream(abs, { encoding: 'utf8' });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  const output = [];
  const MAX_LINE = 4000;
  const MAX_CHARS = 100_000;
  let chars = 0;
  let lineNo = 0;
  let truncated = false;

  try {
    for await (const rawLine of lines) {
      lineNo += 1;
      if (lineNo < offset) continue;
      if (output.length >= limit) {
        truncated = true;
        break;
      }
      let line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, '') : rawLine;
      if (line.length > MAX_LINE) {
        line = `${line.slice(0, MAX_LINE - 1)}…`;
      }
      if (chars + line.length > MAX_CHARS) {
        truncated = true;
        break;
      }
      output.push(`${lineNo}: ${line}`);
      chars += line.length + 1;
    }
  } catch (error) {
    return `tool error: cannot read "${rawPath}": ${error.code || error.message}`;
  } finally {
    lines.close();
    stream.destroy();
  }

  if (output.length === 0) {
    if (lineNo === 0) {
      return `${abs}\n(empty file)`;
    }
    if (offset > lineNo) {
      return `tool error: offset ${offset} is beyond end of file (${lineNo} lines)`;
    }
    return `tool error: no lines at offset ${offset}`;
  }

  const last = offset + output.length - 1;
  let result = `${abs}\n${output.join('\n')}`;
  if (truncated) {
    result += `\n… truncated at line ${last}; use offset=${last + 1} to continue`;
  }
  return result;
}

async function webSearch(query, max) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const html = await response.text();
  if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo too')) {
    throw new Error('DuckDuckGo blocked this search (rate limit/CAPTCHA). Try again later.');
  }

  const results = parseResults(html, max);
  if (results.length === 0) {
    return `No web results found for "${query}".`;
  }

  let out = `Web search results for "${query}":\n`;
  results.forEach((result, index) => {
    out += `${index + 1}. ${result.title}\n   ${result.url}\n`;
    if (result.snippet) {
      out += `   ${truncate(result.snippet, 400)}\n`;
    }
  });
  return out;
}

function parseResults(html, max) {
  const results = [];
  const parts = String(html).split('class="result__a"').slice(1);

  for (const part of parts) {
    if (results.length >= max) break;

    const href = extractBetween(part, 'href="', '"');
    const title = extractBetween(part, '>', '</a>');
    const snippetAt = part.indexOf('class="result__snippet"');
    const snippet =
      snippetAt >= 0
        ? extractBetween(part.slice(snippetAt), '>', '</a>') || ''
        : '';

    if (!href || !title || !title.trim()) continue;

    results.push({
      title: cleanHtml(title),
      url: decodeDdgUrl(decodeEntities(href)),
      snippet: cleanHtml(snippet),
    });
  }
  return results;
}

function extractBetween(text, start, end) {
  const at = text.indexOf(start);
  if (at < 0) return null;
  const from = at + start.length;
  const to = text.indexOf(end, from);
  if (to < 0) return null;
  return text.slice(from, to);
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  deg: '°',
  times: '×',
  divide: '÷',
};

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

function cleanHtml(fragment) {
  return decodeEntities(String(fragment).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeDdgUrl(href) {
  const raw = String(href).trim();
  try {
    const url = new URL(raw, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return target;
    return url.toString();
  } catch {
    return raw.startsWith('//') ? `https:${raw}` : raw;
  }
}

function truncate(text, max) {
  const chars = Array.from(String(text));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}…`;
}

module.exports = {
  SEARCH_URL,
  configure,
  definitions,
  execute,
  statusLabel,
  webSearch,
  // 供 node --test 使用
  _test: {
    parseResults,
    decodeEntities,
    decodeDdgUrl,
    cleanHtml,
    truncate,
  },
};
