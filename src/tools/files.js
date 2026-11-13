'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  computeLineHash,
  formatHashLines,
  applyHashlineEdits,
} = require('./hashline');
const { guardPath } = require('./guard');

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 120_000;
const MAX_SEARCH_OUTPUT = 256_000;

function resolvePath(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('path is required');
  return path.resolve(raw);
}

function isBinary(buffer) {
  return buffer.includes(0);
}

async function readTool(args, context = null) {
  const abs = resolvePath(args.path);
  await guardPath(abs, context, { tool: 'read' });
  const stat = await fs.promises.stat(abs).catch(() => null);
  if (!stat) return `tool error: path does not exist: ${args.path}`;
  if (stat.isDirectory()) {
    const entries = await fs.promises.readdir(abs, { withFileTypes: true });
    const offset = Math.max(1, Number(args.offset) || 1);
    const limit = Math.max(1, Math.min(MAX_READ_LINES, Number(args.limit) || 500));
    const rows = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `${entry.isDirectory() ? '[dir] ' : '[file]'}${entry.name}`);
    const page = rows.slice(offset - 1, offset - 1 + limit);
    return `${abs}\n${page.join('\n')}${
      offset - 1 + limit < rows.length
        ? `\n… truncated; use offset=${offset + limit}`
        : ''
    }`;
  }
  if (!stat.isFile()) return `tool error: not a file: ${args.path}`;

  const buffer = await fs.promises.readFile(abs);
  if (isBinary(buffer.subarray(0, 8192))) {
    return `tool error: binary file, use look_at for images: ${args.path}`;
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Math.max(1, Math.min(MAX_READ_LINES, Number(args.limit) || MAX_READ_LINES));
  const page = lines.slice(offset - 1, offset - 1 + limit);
  let used = 0;
  const output = [];
  for (let i = 0; i < page.length; i += 1) {
    const line = page[i].replace(/\r$/, '');
    const formatted = `${offset + i}#${computeLineHash(
      offset + i,
      line
    )}|${line}`;
    if (used + formatted.length > MAX_READ_CHARS) break;
    output.push(formatted);
    used += formatted.length + 1;
  }
  return `${abs}\n${output.join('\n')}${
    offset - 1 + output.length < lines.length
      ? `\n… truncated at line ${offset + output.length - 1}; use offset=${
          offset + output.length
        }`
      : ''
  }`;
}

async function writeTool(args, context = null) {
  const abs = resolvePath(args.path);
  await guardPath(abs, context, { tool: 'write' });
  const content = String(args.content ?? '');
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, content, 'utf8');
  return `Wrote ${Buffer.byteLength(content)} bytes to ${abs}`;
}

function simpleEdit(abs, oldString, newString, replaceAll) {
  const content = fs.readFileSync(abs, 'utf8');
  const needle = String(oldString ?? '');
  const replacement = String(newString ?? '');
  if (!needle) throw new Error('oldString is required');
  if (needle === replacement) throw new Error('newString must differ from oldString');
  const count = content.split(needle).length - 1;
  if (count === 0) throw new Error('oldString was not found');
  if (!replaceAll && count > 1) {
    throw new Error(`oldString occurs ${count} times; pass replaceAll=true or add context`);
  }
  const next = replaceAll
    ? content.split(needle).join(replacement)
    : content.replace(needle, replacement);
  fs.writeFileSync(abs, next, 'utf8');
  return `Updated ${abs} (${replaceAll ? count : 1} replacement${count === 1 ? '' : 's'})`;
}

async function editTool(args, context = null) {
  if (args.path && (args.oldString !== undefined || args.newString !== undefined)) {
    const abs = resolvePath(args.path);
    await guardPath(abs, context, { tool: 'edit' });
    return simpleEdit(abs, args.oldString, args.newString, Boolean(args.replaceAll));
  }
  const abs = resolvePath(args.filePath || args.path);
  await guardPath(abs, context, { tool: 'edit' });
  if (args.delete === true) {
    await fs.promises.unlink(abs);
    return `Deleted ${abs}`;
  }
  const content = await fs.promises.readFile(abs, 'utf8');
  const next = applyHashlineEdits(content, args.edits);
  await fs.promises.writeFile(abs, next, 'utf8');
  let result = `Updated ${abs}`;
  if (args.rename) {
    const target = resolvePath(args.rename);
    await guardPath(target, context, { tool: 'edit' });
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.rename(abs, target);
    result += ` and moved to ${target}`;
  }
  return result;
}

function rgBinary() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'opencode', 'bin', 'rg.exe'),
    path.join(process.env.USERPROFILE || '', '.cache', 'opencode', 'bin', 'rg.exe'),
    'rg',
  ];
  for (const candidate of candidates) {
    if (candidate === 'rg') return candidate;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return 'rg';
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ code: -1, stdout, stderr: `${stderr}\n(timeout)`, timedOut: true });
    }, options.timeout || 60_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > (options.maxOutput || MAX_SEARCH_OUTPUT)) {
        stdout = stdout.slice(0, options.maxOutput || MAX_SEARCH_OUTPUT);
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function globTool(args, context = null) {
  const pattern = String(args.pattern || '').trim();
  if (!pattern) return 'tool error: glob requires "pattern"';
  const root = resolvePath(
    args.path || (context?.allowedDirs?.[0] || '.')
  );
  await guardPath(root, context, { tool: 'glob' });
  const limit = Math.max(1, Math.min(500, Number(args.limit) || 100));
  const rgArgs = ['--files', '--no-messages', '--glob', pattern];
  if (args.hidden === true) rgArgs.push('--hidden');
  const result = await runProcess(rgBinary(), rgArgs, {
    cwd: root,
    timeout: 60_000,
    maxOutput: MAX_SEARCH_OUTPUT,
  });
  if (result.code !== 0 && result.code !== 1) {
    return `tool error: glob failed: ${result.stderr.trim() || `exit ${result.code}`}`;
  }
  let files = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => path.resolve(root, file));
  if (files.length === 0) return `No files found for ${pattern}`;
  const stats = await Promise.all(
    files.map(async (file) => {
      try {
        const stat = await fs.promises.stat(file);
        return { file, mtime: stat.mtimeMs };
      } catch {
        return { file, mtime: 0 };
      }
    })
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  files = stats.slice(0, limit).map((item) => item.file);
  return `${files.join('\n')}${
    stats.length > limit ? `\n… truncated to ${limit} files` : ''
  }`;
}

async function grepTool(args, context = null) {
  const pattern = String(args.pattern || '');
  if (!pattern) return 'tool error: grep requires "pattern"';
  const root = resolvePath(
    args.path || (context?.allowedDirs?.[0] || '.')
  );
  await guardPath(root, context, { tool: 'grep' });
  let cwd = root;
  let searchPath = '.';
  try {
    const stat = await fs.promises.stat(root);
    if (stat.isFile()) {
      cwd = path.dirname(root);
      searchPath = path.basename(root);
    }
  } catch {
    return `tool error: path does not exist: ${args.path || '.'}`;
  }
  const mode = ['content', 'files_with_matches', 'count'].includes(args.output_mode)
    ? args.output_mode
    : 'files_with_matches';
  const rgArgs = ['--no-messages', '--color', 'never'];
  if (args.literal) rgArgs.push('--fixed-strings');
  if (args.caseSensitive === false) rgArgs.push('--ignore-case');
  else rgArgs.push('--case-sensitive');
  if (mode === 'files_with_matches') rgArgs.push('--files-with-matches');
  else if (mode === 'count') rgArgs.push('--count');
  else rgArgs.push('--line-number', '--no-heading');
  if (args.include) rgArgs.push('--glob', String(args.include));
  rgArgs.push('--', pattern, searchPath);
  const result = await runProcess(rgBinary(), rgArgs, {
    cwd,
    timeout: 60_000,
    maxOutput: MAX_SEARCH_OUTPUT,
  });
  if (result.code !== 0 && result.code !== 1) {
    return `tool error: grep failed: ${result.stderr.trim() || `exit ${result.code}`}`;
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return `No matches found for ${pattern}`;
  const headLimit = Math.max(0, Number(args.head_limit) || 0);
  const limited = headLimit > 0 ? lines.slice(0, headLimit) : lines;
  const rendered =
    mode === 'content'
      ? limited.map((line) => `  ${line}`).join('\n')
      : limited.join('\n');
  return `${rendered}${
    limited.length < lines.length ? `\n… truncated to ${limited.length} results` : ''
  }`;
}

function patchPaths(text) {
  const paths = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const diff = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diff) {
      paths.add(diff[2]);
      continue;
    }
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    if (plus && plus[1] !== '/dev/null') {
      paths.add(plus[1]);
      continue;
    }
    const minus = line.match(/^--- a\/(.+)$/);
    if (minus && minus[1] !== '/dev/null') {
      paths.add(minus[1]);
    }
  }
  return [...paths];
}

async function patchTool(args, context = null) {
  const patchText = String(args.patchText || '');
  if (!patchText.trim()) return 'tool error: patchText is required';
  const cwd = context?.allowedDirs?.[0] || process.cwd();
  for (const relative of patchPaths(patchText)) {
    await guardPath(path.resolve(cwd, relative), context, {
      tool: 'patch',
    });
  }
  const temp = path.join(
    process.env.TEMP || process.env.TMP || process.cwd(),
    `yah-patch-${Date.now()}.diff`
  );
  await fs.promises.writeFile(temp, patchText, 'utf8');
  try {
    const result = await runProcess('git', ['apply', '--whitespace=nowarn', temp], {
      cwd,
      timeout: 60_000,
    });
    if (result.code !== 0) {
      return `tool error: patch failed: ${result.stderr.trim() || `exit ${result.code}`}`;
    }
    return 'Success. Applied patch.';
  } finally {
    await fs.promises.unlink(temp).catch(() => undefined);
  }
}

module.exports = {
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  patchTool,
};
