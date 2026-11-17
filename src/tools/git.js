'use strict';

// Structured Git tools. Every command runs through execFile with an explicit
// argv array (no shell), and paths are passed after `--`. Results are JSON.
// Destructive operations require an explicit confirm flag and are never
// reachable through a generic command string.

const path = require('node:path');
const { execFile } = require('node:child_process');
const { guardPath, isInside } = require('./guard');

const DEFAULT_TIMEOUT = 120_000;
const MAX_BUFFER = 32 * 1024 * 1024;
const MAX_TEXT = 200_000;
const LOG_FORMAT =
  '%H%x00%h%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x1e';
const BRANCH_FORMAT =
  '%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(objectname:short)%00%(committerdate:iso-strict)';
const TAG_FORMAT =
  '%(refname:short)%00%(objecttype)%00%(subject)%00%(creatordate:iso-strict)%00%(objectname:short)';
const STASH_FORMAT = '%gd%x00%ci%x00%s';

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_PAGER: 'cat',
    GIT_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
  };
}

function execGit(cwd, argv, options = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      argv,
      {
        cwd,
        windowsHide: true,
        timeout: options.timeout || DEFAULT_TIMEOUT,
        maxBuffer: options.maxBuffer || MAX_BUFFER,
        encoding: 'utf8',
        env: gitEnv(),
      },
      (error, stdout, stderr) => {
        const code = error
          ? typeof error.code === 'number'
            ? error.code
            : 1
          : 0;
        resolve({
          ok: !error,
          code,
          stdout: stdout || '',
          stderr: stderr || '',
          message: error?.message || '',
        });
      }
    );
  });
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function clip(value, max = MAX_TEXT) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… truncated (${text.length - max} more characters)`;
}

function invalid(message) {
  return `tool error: ${message}`;
}

function failure(result, extra = {}) {
  return json({
    ok: false,
    ...extra,
    exitCode: Number.isInteger(result?.code) ? result.code : 1,
    error: String(result?.stderr || result?.message || 'git command failed').trim(),
    stdout: clip(result?.stdout || ''),
    stderr: clip(result?.stderr || ''),
  });
}

function commandText(result) {
  return clip(
    `${result?.stdout || ''}${result?.stderr || ''}`
      .replace(/\r/g, '')
      .trim()
  );
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function checkedRef(value, name, options = {}) {
  const ref = String(value ?? '').trim();
  if (!ref) return { error: invalid(`${name} is required`) };
  if (ref.startsWith('-')) {
    return { error: invalid(`${name} must not start with "-"`) };
  }
  if (/[\0\r\n]/.test(ref)) {
    return { error: invalid(`${name} contains control characters`) };
  }
  if (options.branch) {
    if (
      /\s/.test(ref) ||
      ref.includes('..') ||
      ref.includes('@{') ||
      /[~^:?*[\\]/.test(ref) ||
      ref.startsWith('/') ||
      ref.endsWith('/') ||
      ref.endsWith('.') ||
      ref.endsWith('.lock')
    ) {
      return { error: invalid(`invalid branch name: ${ref}`) };
    }
  }
  return { value: ref };
}

function checkedRemote(value, name = 'remote') {
  const remote = String(value ?? '').trim();
  if (!remote) return { error: invalid(`${name} is required`) };
  if (remote.startsWith('-') || /\s/.test(remote)) {
    return { error: invalid(`invalid ${name}: ${remote}`) };
  }
  return { value: remote };
}

async function resolveRepo(args = {}, context = null, tool = 'git') {
  const allowed = Array.isArray(context?.allowedDirs) ? context.allowedDirs : [];
  const base = allowed[0] || process.cwd();
  const raw = String(args.repoDir || '').trim();
  const start = raw ? path.resolve(base, raw) : path.resolve(base);
  await guardPath(start, context, { tool });
  const probe = await execGit(start, ['rev-parse', '--show-toplevel']);
  if (!probe.ok) {
    return { error: invalid(`not a git repository: ${start}`) };
  }
  const root = probe.stdout.trim();
  if (!root) return { error: invalid(`not a git repository: ${start}`) };
  return { root };
}

async function guardInputPaths(root, paths, context, tool) {
  for (const value of paths) {
    const raw = String(value ?? '').trim();
    if (!raw) continue;
    // Git pathspec magic and globs are resolved by git itself. Everything
    // else is checked so a symlink cannot escape the project directories.
    if (raw.startsWith(':') || /[*?[\]{}]/.test(raw)) continue;
    const absolute = path.resolve(root, raw);
    if (!isInside(root, absolute)) {
      throw new Error(`path is outside the repository: ${raw}`);
    }
    await guardPath(absolute, context, { tool });
  }
}

function parseStatus(output) {
  const parts = String(output || '').split('\0');
  const state = {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    ignored: [],
  };

  for (let index = 0; index < parts.length; index += 1) {
    const raw = parts[index];
    if (!raw) continue;

    if (raw.startsWith('# ')) {
      const message = raw.slice(2);
      const space = message.indexOf(' ');
      const key = space === -1 ? message : message.slice(0, space);
      const value = space === -1 ? '' : message.slice(space + 1);
      if (key === 'branch.oid') {
        state.oid = value === '(initial)' ? null : value;
      } else if (key === 'branch.head') {
        state.detached = value === '(detached)';
        state.branch = state.detached ? null : value;
      } else if (key === 'branch.upstream') {
        state.upstream = value;
      } else if (key === 'branch.ab') {
        const match = value.match(/^\+(\d+) -(\d+)$/);
        if (match) {
          state.ahead = Number(match[1]);
          state.behind = Number(match[2]);
        }
      }
      continue;
    }

    const kind = raw[0];
    if (kind === '1') {
      const match = raw.match(
        /^1 (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/s
      );
      if (!match) continue;
      const entry = {
        path: match[8],
        index: match[1][0],
        worktree: match[1][1],
      };
      if (match[1][0] !== '.') state.staged.push(entry);
      if (match[1][1] !== '.') state.unstaged.push(entry);
      continue;
    }

    if (kind === '2') {
      const match = raw.match(
        /^2 (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/s
      );
      if (!match) continue;
      const entry = {
        path: match[9],
        index: match[1][0],
        worktree: match[1][1],
        renameFrom: parts[index + 1] || null,
      };
      index += 1;
      if (match[1][0] !== '.') state.staged.push(entry);
      if (match[1][1] !== '.') state.unstaged.push(entry);
      continue;
    }

    if (kind === 'u') {
      const match = raw.match(
        /^u (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/s
      );
      if (!match) continue;
      state.conflicted.push({
        path: match[10],
        index: match[1][0],
        worktree: match[1][1],
      });
      continue;
    }

    if (kind === '?') {
      state.untracked.push({ path: raw.slice(2) });
      continue;
    }

    if (kind === '!') {
      state.ignored.push({ path: raw.slice(2) });
    }
  }

  state.clean =
    state.staged.length === 0 &&
    state.unstaged.length === 0 &&
    state.untracked.length === 0 &&
    state.conflicted.length === 0;
  return state;
}

async function loadStatus(root) {
  const result = await execGit(root, [
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
  ]);
  if (!result.ok) return { failure: failure(result) };
  return { status: parseStatus(result.stdout) };
}

function statusSummary(status) {
  return {
    branch: status.branch,
    detached: status.detached,
    clean: status.clean,
    staged: status.staged.length,
    unstaged: status.unstaged.length,
    untracked: status.untracked.length,
    conflicted: status.conflicted.length,
  };
}

function parseNumstat(output) {
  const chunks = String(output || '').split('\0');
  const files = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const match = chunk.match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
    if (!match) continue;
    let filePath = match[3];
    let oldPath = null;
    // Rename records with -z contain an empty path followed by old and new.
    if (!filePath) {
      oldPath = chunks[index + 1] || null;
      filePath = chunks[index + 2] || '';
      index += 2;
    }
    if (!filePath) continue;
    files.push({
      path: filePath,
      additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2]),
      binary: match[1] === '-' || match[2] === '-',
      ...(oldPath ? { oldPath } : {}),
    });
  }
  return files;
}

function totalsFor(files) {
  return files.reduce(
    (total, file) => {
      total.files += 1;
      if (file.additions !== null) total.insertions += file.additions;
      if (file.deletions !== null) total.deletions += file.deletions;
      return total;
    },
    { files: 0, insertions: 0, deletions: 0 }
  );
}

function parseCommits(output) {
  return String(output || '')
    .split('\x1e')
    .map((record) => record.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, email, date, refs, subject, body] =
        record.split('\0');
      return {
        hash,
        shortHash,
        author,
        email,
        date,
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        subject,
        body: String(body || '').trim(),
      };
    });
}

async function commitDetails(root, rev) {
  const meta = await execGit(root, [
    'show',
    '-s',
    '--no-color',
    `--format=${LOG_FORMAT}`,
    rev,
  ]);
  if (!meta.ok) return { failure: failure(meta) };
  const commit = parseCommits(meta.stdout)[0];
  if (!commit) return { failure: invalid(`commit not found: ${rev}`) };

  const stats = await execGit(root, [
    'show',
    '--numstat',
    '-z',
    '--format=',
    rev,
  ]);
  if (!stats.ok) return { failure: failure(stats), commit };
  const files = parseNumstat(stats.stdout);
  return { commit, files, totals: totalsFor(files) };
}

function parseBranches(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [head, name, upstream, track, hash, date] = line.split('\0');
      const trackText = track || '';
      const ahead = Number((trackText.match(/ahead (\d+)/) || [])[1] || 0);
      const behind = Number((trackText.match(/behind (\d+)/) || [])[1] || 0);
      return {
        name,
        current: head === '*',
        upstream: upstream || null,
        ahead,
        behind,
        gone: /gone/i.test(trackText),
        hash,
        date,
      };
    });
}

async function listBranches(root, all = false) {
  const result = await execGit(root, [
    'branch',
    ...(all ? ['--all'] : []),
    `--format=${BRANCH_FORMAT}`,
  ]);
  if (!result.ok) return { failure: failure(result) };
  return { branches: parseBranches(result.stdout) };
}

function parseRemotes(output) {
  const map = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const name = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const match = rest.match(/^(.*) \((fetch|push)\)$/);
    if (!match) continue;
    if (!map.has(name)) {
      map.set(name, { name, fetch: null, push: null });
    }
    map.get(name)[match[2]] = match[1];
  }
  return [...map.values()];
}

async function listRemotes(root) {
  const result = await execGit(root, ['remote', '-v']);
  if (!result.ok) return { failure: failure(result) };
  return { remotes: parseRemotes(result.stdout) };
}

function parseTags(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, type, subject, date, hash] = line.split('\0');
      return { name, type, subject, date, hash };
    });
}

async function listTags(root) {
  const result = await execGit(root, ['tag', '--list', `--format=${TAG_FORMAT}`]);
  if (!result.ok) return { failure: failure(result) };
  return { tags: parseTags(result.stdout) };
}

function parseStashes(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [ref, date, subject] = line.split('\0');
      return { ref, date, subject };
    });
}

async function listStashes(root) {
  const result = await execGit(root, ['stash', 'list', `--format=${STASH_FORMAT}`]);
  if (!result.ok) return { failure: failure(result) };
  return { stashes: parseStashes(result.stdout) };
}

function parseBlame(output) {
  const entries = [];
  let current = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (/^[0-9a-f]{40} \d+ \d+/.test(line)) {
      if (current) entries.push(current);
      const parts = line.split(' ');
      current = {
        commit: parts[0],
        shortHash: parts[0].slice(0, 8),
        line: Number(parts[2]),
        author: '',
        date: null,
        summary: '',
        path: '',
        text: '',
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\t')) {
      current.text = line.slice(1);
      continue;
    }
    const space = line.indexOf(' ');
    if (space === -1) continue;
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (key === 'author') current.author = value;
    else if (key === 'author-time') {
      current.date = new Date(Number(value) * 1000).toISOString();
    } else if (key === 'summary') current.summary = value;
    else if (key === 'filename') current.path = value;
  }
  if (current) entries.push(current);
  return entries;
}

async function conflictedStatus(root) {
  const loaded = await loadStatus(root);
  if (loaded.failure) return null;
  return statusSummary(loaded.status);
}

async function gitStatus(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_status');
  if (repo.error) return repo.error;
  const loaded = await loadStatus(repo.root);
  if (loaded.failure) return loaded.failure;
  return json({ ok: true, repo: repo.root, ...loaded.status });
}

async function gitDiff(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_diff');
  if (repo.error) return repo.error;

  const staged = args.staged === true;
  let rev = null;
  if (String(args.rev || '').trim()) {
    const checked = checkedRef(args.rev, 'rev');
    if (checked.error) return checked.error;
    rev = checked.value;
  }
  if (staged && rev) {
    return invalid('staged and rev cannot be used together');
  }

  const paths = Array.isArray(args.paths)
    ? args.paths.map((item) => String(item)).filter(Boolean)
    : [];
  await guardInputPaths(repo.root, paths, context, 'git_diff');
  const contextLines = clampInt(args.context, 3, 0, 50);
  const base = ['diff', '--no-color', '--no-ext-diff'];
  const target = staged ? ['--cached'] : rev ? [rev] : [];
  const pathArgs = paths.length ? ['--', ...paths] : [];

  const stats = await execGit(repo.root, [
    ...base,
    '--numstat',
    '-z',
    ...target,
    ...pathArgs,
  ]);
  if (!stats.ok) return failure(stats);

  const files = parseNumstat(stats.stdout);
  const output = {
    ok: true,
    repo: repo.root,
    staged,
    rev,
    files,
    totals: totalsFor(files),
  };

  if (args.patch !== false) {
    const patch = await execGit(repo.root, [
      ...base,
      `--unified=${contextLines}`,
      ...target,
      ...pathArgs,
    ]);
    if (!patch.ok) return failure(patch);
    output.patch = clip(patch.stdout);
    output.patchTruncated = patch.stdout.length > MAX_TEXT;
  }

  return json(output);
}

async function gitLog(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_log');
  if (repo.error) return repo.error;

  const limit = clampInt(args.limit, 20, 1, 200);
  const argv = ['log', '--no-color', `--format=${LOG_FORMAT}`, '-n', String(limit)];

  if (String(args.rev || '').trim()) {
    const rev = checkedRef(args.rev, 'rev');
    if (rev.error) return rev.error;
    argv.push(rev.value);
  }
  for (const [key, option] of [
    ['author', '--author'],
    ['since', '--since'],
    ['until', '--until'],
    ['grep', '--grep'],
  ]) {
    if (String(args[key] || '').trim()) {
      argv.push(`${option}=${String(args[key]).trim()}`);
    }
  }

  if (String(args.path || '').trim()) {
    const filePath = String(args.path).trim();
    await guardInputPaths(repo.root, [filePath], context, 'git_log');
    argv.push('--', filePath);
  }

  const result = await execGit(repo.root, argv);
  if (!result.ok) return failure(result);
  return json({
    ok: true,
    repo: repo.root,
    limit,
    commits: parseCommits(result.stdout),
  });
}

async function gitShow(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_show');
  if (repo.error) return repo.error;

  const checked = checkedRef(args.rev || 'HEAD', 'rev');
  if (checked.error) return checked.error;
  const details = await commitDetails(repo.root, checked.value);
  if (details.failure) return details.failure;

  const output = {
    ok: true,
    repo: repo.root,
    ...details,
  };

  if (args.patch !== false) {
    const contextLines = clampInt(args.context, 3, 0, 50);
    const patch = await execGit(repo.root, [
      'show',
      '--no-color',
      '--no-ext-diff',
      `--unified=${contextLines}`,
      '--format=',
      checked.value,
    ]);
    if (!patch.ok) return failure(patch);
    output.patch = clip(patch.stdout);
    output.patchTruncated = patch.stdout.length > MAX_TEXT;
  }

  return json(output);
}

async function gitBlame(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_blame');
  if (repo.error) return repo.error;

  const filePath = checkedRef(args.path, 'path');
  if (filePath.error) return filePath.error;
  await guardInputPaths(repo.root, [filePath.value], context, 'git_blame');

  const maxLines = clampInt(args.maxLines, 200, 1, 1000);
  const start = clampInt(args.startLine, 1, 1, 2_147_483_647);
  let range = `-L ${start},+${maxLines}`;
  if (args.endLine !== undefined && args.endLine !== null && args.endLine !== '') {
    const end = clampInt(args.endLine, start, start, 2_147_483_647);
    range = `-L ${start},${end}`;
  }

  const rev = String(args.rev || '').trim()
    ? checkedRef(args.rev, 'rev')
    : { value: 'HEAD' };
  if (rev.error) return rev.error;

  const result = await execGit(repo.root, [
    'blame',
    '--line-porcelain',
    range,
    rev.value,
    '--',
    filePath.value,
  ]);
  if (!result.ok) return failure(result);
  return json({
    ok: true,
    repo: repo.root,
    path: filePath.value,
    rev: rev.value,
    lines: parseBlame(result.stdout),
  });
}

async function gitBranch(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_branch');
  if (repo.error) return repo.error;

  const action = String(args.action || 'list').toLowerCase();
  if (action === 'list') {
    const listed = await listBranches(repo.root, args.all === true);
    if (listed.failure) return listed.failure;
    return json({ ok: true, repo: repo.root, branches: listed.branches });
  }

  if (action === 'create') {
    const name = checkedRef(args.name, 'name', { branch: true });
    if (name.error) return name.error;
    const argv = ['branch', name.value];
    if (String(args.startPoint || '').trim()) {
      const start = checkedRef(args.startPoint, 'startPoint');
      if (start.error) return start.error;
      argv.push(start.value);
    }
    const result = await execGit(repo.root, argv);
    if (!result.ok) return failure(result);
    const listed = await listBranches(repo.root, args.all === true);
    return json({
      ok: true,
      repo: repo.root,
      action,
      branch: name.value,
      branches: listed.branches || [],
    });
  }

  if (action === 'delete') {
    const name = checkedRef(args.name, 'name');
    if (name.error) return name.error;
    if (args.confirm !== true) {
      return invalid('deleting a branch requires confirm:true');
    }
    const current = await execGit(repo.root, ['branch', '--show-current']);
    if (current.ok && current.stdout.trim() === name.value) {
      return invalid('cannot delete the current branch');
    }
    const argv = ['branch', args.force === true ? '-D' : '-d', name.value];
    const result = await execGit(repo.root, argv);
    if (!result.ok) return failure(result);
    const listed = await listBranches(repo.root, args.all === true);
    return json({
      ok: true,
      repo: repo.root,
      action,
      branch: name.value,
      branches: listed.branches || [],
    });
  }

  if (action === 'rename') {
    const name = checkedRef(args.name, 'name');
    if (name.error) return name.error;
    const newName = checkedRef(args.newName, 'newName', { branch: true });
    if (newName.error) return newName.error;
    const result = await execGit(repo.root, [
      'branch',
      '-m',
      name.value,
      newName.value,
    ]);
    if (!result.ok) return failure(result);
    const listed = await listBranches(repo.root, args.all === true);
    return json({
      ok: true,
      repo: repo.root,
      action,
      branch: newName.value,
      branches: listed.branches || [],
    });
  }

  return invalid(`unknown git_branch action: ${action}`);
}

async function gitCheckout(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_checkout');
  if (repo.error) return repo.error;

  const target = checkedRef(args.target, 'target');
  if (target.error) return target.error;
  const argv = args.create === true
    ? ['checkout', '-b', target.value]
    : ['checkout', target.value];
  if (args.create === true && String(args.startPoint || '').trim()) {
    const start = checkedRef(args.startPoint, 'startPoint');
    if (start.error) return start.error;
    argv.push(start.value);
  }

  const result = await execGit(repo.root, argv);
  if (!result.ok) return failure(result);
  const loaded = await loadStatus(repo.root);
  return json({
    ok: true,
    repo: repo.root,
    target: target.value,
    summary: commandText(result),
    ...(loaded.status ? statusSummary(loaded.status) : {}),
  });
}

async function gitAdd(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_add');
  if (repo.error) return repo.error;

  const paths = Array.isArray(args.paths)
    ? args.paths.map((item) => String(item)).filter(Boolean)
    : [];
  const all = args.all === true;
  const update = args.update === true;
  if (all && update) return invalid('all and update cannot be used together');
  if (all && paths.length) return invalid('all and paths cannot be used together');
  if (update && paths.length) {
    return invalid('update and paths cannot be used together');
  }
  if (!all && !update && paths.length === 0) {
    return invalid('provide paths, all:true, or update:true');
  }

  await guardInputPaths(repo.root, paths, context, 'git_add');
  const argv = all
    ? ['add', '-A']
    : update
      ? ['add', '-u']
      : ['add', '--', ...paths];
  const result = await execGit(repo.root, argv);
  if (!result.ok) return failure(result);

  const loaded = await loadStatus(repo.root);
  return json({
    ok: true,
    repo: repo.root,
    summary: commandText(result),
    ...(loaded.status
      ? {
          staged: loaded.status.staged,
          unstaged: loaded.status.unstaged.length,
          untracked: loaded.status.untracked.length,
        }
      : {}),
  });
}

async function gitCommit(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_commit');
  if (repo.error) return repo.error;

  const message = String(args.message || '').trim();
  if (!message) return invalid('message is required');
  const amend = args.amend === true;
  if (amend && args.confirm !== true) {
    return invalid('amending a commit requires confirm:true');
  }

  const loaded = await loadStatus(repo.root);
  if (!loaded.status) return loaded.failure;
  if (!amend && args.allowEmpty !== true && loaded.status.staged.length === 0) {
    return invalid('nothing is staged; use git_add first or set allowEmpty:true');
  }

  const argv = ['commit', '-m', message];
  if (amend) argv.push('--amend');
  if (args.allowEmpty === true) argv.push('--allow-empty');
  const result = await execGit(repo.root, argv);
  if (!result.ok) return failure(result);

  const details = await commitDetails(repo.root, 'HEAD');
  if (details.failure) return details.failure;
  return json({
    ok: true,
    repo: repo.root,
    amended: amend,
    summary: commandText(result),
    ...details,
  });
}

async function gitStash(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_stash');
  if (repo.error) return repo.error;

  const action = String(args.action || 'list').toLowerCase();
  const index = clampInt(args.index, 0, 0, 100_000);

  if (action === 'list') {
    const listed = await listStashes(repo.root);
    if (listed.failure) return listed.failure;
    return json({ ok: true, repo: repo.root, stashes: listed.stashes });
  }

  if (action === 'push') {
    const paths = Array.isArray(args.paths)
      ? args.paths.map((item) => String(item)).filter(Boolean)
      : [];
    await guardInputPaths(repo.root, paths, context, 'git_stash');
    const argv = ['stash', 'push'];
    if (args.includeUntracked === true) argv.push('--include-untracked');
    if (String(args.message || '').trim()) {
      argv.push('-m', String(args.message).trim());
    }
    if (paths.length) argv.push('--', ...paths);
    const result = await execGit(repo.root, argv);
    if (!result.ok) return failure(result);
    const listed = await listStashes(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action,
      summary: commandText(result),
      stashes: listed.stashes || [],
    });
  }

  if (action === 'pop' || action === 'apply') {
    const result = await execGit(repo.root, [
      'stash',
      action,
      `stash@{${index}}`,
    ]);
    if (!result.ok) {
      return failure(result, { status: await conflictedStatus(repo.root) });
    }
    const loaded = await loadStatus(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action,
      index,
      summary: commandText(result),
      ...(loaded.status ? statusSummary(loaded.status) : {}),
    });
  }

  if (action === 'drop' || action === 'clear') {
    if (args.confirm !== true) {
      return invalid(`${action} requires confirm:true`);
    }
    const argv =
      action === 'clear'
        ? ['stash', 'clear']
        : ['stash', 'drop', `stash@{${index}}`];
    const result = await execGit(repo.root, argv);
    if (!result.ok) return failure(result);
    const listed = await listStashes(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action,
      summary: commandText(result),
      stashes: listed.stashes || [],
    });
  }

  if (action === 'show') {
    const result = await execGit(repo.root, [
      'stash',
      'show',
      '--patch',
      `stash@{${index}}`,
    ]);
    if (!result.ok) return failure(result);
    return json({
      ok: true,
      repo: repo.root,
      action,
      index,
      patch: clip(result.stdout),
    });
  }

  return invalid(`unknown git_stash action: ${action}`);
}

async function gitFetch(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_fetch');
  if (repo.error) return repo.error;

  const all = args.all === true;
  const remote = String(args.remote || '').trim();
  const branch = String(args.branch || '').trim();
  if (all && remote) return invalid('all and remote cannot be used together');
  if (branch && !remote) return invalid('branch requires remote');

  const argv = ['fetch'];
  if (all) argv.push('--all');
  if (args.prune === true) argv.push('--prune');
  if (args.tags === true) argv.push('--tags');
  if (remote) {
    const checked = checkedRemote(remote);
    if (checked.error) return checked.error;
    argv.push(checked.value);
  }
  if (branch) {
    const checked = checkedRef(branch, 'branch');
    if (checked.error) return checked.error;
    argv.push(checked.value);
  }

  const result = await execGit(repo.root, argv);
  if (!result.ok) return failure(result);
  return json({
    ok: true,
    repo: repo.root,
    summary: commandText(result),
  });
}

async function gitPull(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_pull');
  if (repo.error) return repo.error;

  const remote = String(args.remote || '').trim();
  const branch = String(args.branch || '').trim();
  if (branch && !remote) return invalid('branch requires remote');

  const argv = ['pull'];
  if (args.ffOnly !== false) argv.push('--ff-only');
  else argv.push('--no-rebase');
  if (remote) {
    const checked = checkedRemote(remote);
    if (checked.error) return checked.error;
    argv.push(checked.value);
  }
  if (branch) {
    const checked = checkedRef(branch, 'branch');
    if (checked.error) return checked.error;
    argv.push(checked.value);
  }

  const result = await execGit(repo.root, argv, { timeout: 5 * 60_000 });
  if (!result.ok) {
    return failure(result, { status: await conflictedStatus(repo.root) });
  }
  const loaded = await loadStatus(repo.root);
  return json({
    ok: true,
    repo: repo.root,
    summary: commandText(result),
    ...(loaded.status ? statusSummary(loaded.status) : {}),
  });
}

async function gitPush(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_push');
  if (repo.error) return repo.error;

  const remote = String(args.remote || '').trim();
  const branch = String(args.branch || '').trim();
  if (branch && !remote) return invalid('branch requires remote');
  if (args.setUpstream === true && (!remote || !branch)) {
    return invalid('setUpstream requires remote and branch');
  }

  const argv = ['push'];
  if (args.setUpstream === true) argv.push('--set-upstream');
  if (args.tags === true) argv.push('--tags');
  if (remote) {
    const checked = checkedRemote(remote);
    if (checked.error) return checked.error;
    argv.push(checked.value);
  }
  if (branch) {
    const checked = checkedRef(branch, 'branch');
    if (checked.error) return checked.error;
    argv.push(checked.value);
  }

  const result = await execGit(repo.root, argv, { timeout: 5 * 60_000 });
  if (!result.ok) {
    return failure(result, { status: await conflictedStatus(repo.root) });
  }
  return json({
    ok: true,
    repo: repo.root,
    summary: commandText(result),
    rejected: /rejected|non-fast-forward/i.test(result.stderr || ''),
  });
}

async function gitMerge(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_merge');
  if (repo.error) return repo.error;

  const action = String(args.action || 'merge').toLowerCase();
  let argv;
  if (action === 'abort') {
    argv = ['merge', '--abort'];
  } else if (action === 'continue') {
    argv = ['merge', '--continue'];
  } else if (action === 'merge') {
    const branch = checkedRef(args.branch, 'branch');
    if (branch.error) return branch.error;
    argv = ['merge', '--no-edit'];
    if (args.noFastForward === true) argv.push('--no-ff');
    if (String(args.message || '').trim()) {
      argv.push('-m', String(args.message).trim());
    }
    argv.push(branch.value);
  } else {
    return invalid(`unknown git_merge action: ${action}`);
  }

  const result = await execGit(repo.root, argv);
  if (!result.ok) {
    return failure(result, { status: await conflictedStatus(repo.root) });
  }
  const loaded = await loadStatus(repo.root);
  return json({
    ok: true,
    repo: repo.root,
    action,
    summary: commandText(result),
    ...(loaded.status ? statusSummary(loaded.status) : {}),
  });
}

async function gitRemote(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_remote');
  if (repo.error) return repo.error;

  const action = String(args.action || 'list').toLowerCase();
  if (action === 'list') {
    const listed = await listRemotes(repo.root);
    if (listed.failure) return listed.failure;
    return json({ ok: true, repo: repo.root, remotes: listed.remotes });
  }

  if (action === 'add' || action === 'seturl') {
    const name = checkedRemote(args.name, 'name');
    if (name.error) return name.error;
    const url = String(args.url || '').trim();
    if (!url) return invalid('url is required');
    if (url.startsWith('-')) return invalid('url must not start with "-"');
    const argv =
      action === 'add'
        ? ['remote', 'add', name.value, url]
        : ['remote', 'set-url', name.value, url];
    const result = await execGit(repo.root, argv);
    if (!result.ok) return failure(result);
    const listed = await listRemotes(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action: action === 'seturl' ? 'setUrl' : action,
      summary: commandText(result),
      remotes: listed.remotes || [],
    });
  }

  if (action === 'remove') {
    const name = checkedRemote(args.name, 'name');
    if (name.error) return name.error;
    if (args.confirm !== true) {
      return invalid('removing a remote requires confirm:true');
    }
    const result = await execGit(repo.root, ['remote', 'remove', name.value]);
    if (!result.ok) return failure(result);
    const listed = await listRemotes(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action,
      summary: commandText(result),
      remotes: listed.remotes || [],
    });
  }

  if (action === 'rename') {
    const name = checkedRemote(args.name, 'name');
    if (name.error) return name.error;
    const newName = checkedRemote(args.newName, 'newName');
    if (newName.error) return newName.error;
    const result = await execGit(repo.root, [
      'remote',
      'rename',
      name.value,
      newName.value,
    ]);
    if (!result.ok) return failure(result);
    const listed = await listRemotes(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action,
      summary: commandText(result),
      remotes: listed.remotes || [],
    });
  }

  return invalid(`unknown git_remote action: ${action}`);
}

async function gitTag(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_tag');
  if (repo.error) return repo.error;

  const action = String(args.action || 'list').toLowerCase();
  if (action === 'list') {
    const listed = await listTags(repo.root);
    if (listed.failure) return listed.failure;
    return json({ ok: true, repo: repo.root, tags: listed.tags });
  }

  if (action === 'create') {
    const name = checkedRef(args.name, 'name', { branch: true });
    if (name.error) return name.error;
    const message = String(args.message || '').trim();
    const argv = message
      ? ['tag', '-a', name.value, '-m', message]
      : ['tag', name.value];
    if (String(args.target || '').trim()) {
      const target = checkedRef(args.target, 'target');
      if (target.error) return target.error;
      argv.push(target.value);
    }
    const result = await execGit(repo.root, argv);
    if (!result.ok) return failure(result);
    const listed = await listTags(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action,
      tag: name.value,
      tags: listed.tags || [],
    });
  }

  if (action === 'delete') {
    const name = checkedRef(args.name, 'name');
    if (name.error) return name.error;
    if (args.confirm !== true) {
      return invalid('deleting a tag requires confirm:true');
    }
    const result = await execGit(repo.root, ['tag', '-d', name.value]);
    if (!result.ok) return failure(result);
    const listed = await listTags(repo.root);
    return json({
      ok: true,
      repo: repo.root,
      action,
      tag: name.value,
      tags: listed.tags || [],
    });
  }

  return invalid(`unknown git_tag action: ${action}`);
}

async function gitRestore(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_restore');
  if (repo.error) return repo.error;

  const paths = Array.isArray(args.paths)
    ? args.paths.map((item) => String(item)).filter(Boolean)
    : [];
  if (paths.length === 0) return invalid('paths is required');
  await guardInputPaths(repo.root, paths, context, 'git_restore');

  const staged = args.staged === true;
  const worktree = args.worktree === true || !staged;
  if (worktree && args.confirm !== true) {
    return invalid('restoring working tree files requires confirm:true');
  }

  const argv = ['restore'];
  if (staged) argv.push('--staged');
  if (worktree) argv.push('--worktree');
  if (String(args.source || '').trim()) {
    const source = checkedRef(args.source, 'source');
    if (source.error) return source.error;
    argv.push(`--source=${source.value}`);
  }
  argv.push('--', ...paths);

  const result = await execGit(repo.root, argv);
  if (!result.ok) return failure(result);
  const loaded = await loadStatus(repo.root);
  return json({
    ok: true,
    repo: repo.root,
    summary: commandText(result),
    ...(loaded.status ? statusSummary(loaded.status) : {}),
  });
}

async function gitReset(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'git_reset');
  if (repo.error) return repo.error;

  const mode = ['soft', 'mixed', 'hard'].includes(
    String(args.mode || '').toLowerCase()
  )
    ? String(args.mode).toLowerCase()
    : 'mixed';
  if (mode === 'hard' && args.confirm !== true) {
    return invalid('hard reset requires confirm:true');
  }
  const target = checkedRef(args.target || 'HEAD', 'target');
  if (target.error) return target.error;

  const result = await execGit(repo.root, [
    'reset',
    `--${mode}`,
    target.value,
  ]);
  if (!result.ok) return failure(result);
  const loaded = await loadStatus(repo.root);
  return json({
    ok: true,
    repo: repo.root,
    mode,
    target: target.value,
    summary: commandText(result),
    ...(loaded.status ? statusSummary(loaded.status) : {}),
  });
}

async function sequenceTool(command, args, context, tool) {
  const repo = await resolveRepo(args, context, tool);
  if (repo.error) return repo.error;

  const action = String(args.action || 'start').toLowerCase();
  let argv;
  if (action === 'abort') {
    argv = [command, '--abort'];
  } else if (action === 'continue') {
    argv = [command, '--continue'];
  } else if (action === 'start') {
    const commits = Array.isArray(args.commits)
      ? args.commits.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (commits.length === 0) return invalid('commits is required');
    argv = [command, '--no-edit'];
    if (args.noCommit === true) argv.push('--no-commit');
    if (args.mainline !== undefined && args.mainline !== null) {
      const mainline = clampInt(args.mainline, 1, 1, 100);
      argv.push('-m', String(mainline));
    }
    for (const commit of commits) {
      const checked = checkedRef(commit, 'commit');
      if (checked.error) return checked.error;
      argv.push(checked.value);
    }
  } else {
    return invalid(`unknown ${tool} action: ${action}`);
  }

  const result = await execGit(repo.root, argv);
  if (!result.ok) {
    return failure(result, { status: await conflictedStatus(repo.root) });
  }
  const loaded = await loadStatus(repo.root);
  return json({
    ok: true,
    repo: repo.root,
    action,
    summary: commandText(result),
    ...(loaded.status ? statusSummary(loaded.status) : {}),
  });
}

async function gitRevert(args = {}, context = null) {
  return sequenceTool('revert', args, context, 'git_revert');
}

async function gitCherryPick(args = {}, context = null) {
  return sequenceTool('cherry-pick', args, context, 'git_cherry_pick');
}

async function worktreeList(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'worktree_list');
  if (repo.error) return repo.error;

  const result = await execGit(repo.root, ['worktree', 'list', '--porcelain']);
  if (!result.ok) return failure(result);

  const worktrees = result.stdout
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const directory = lines.find((line) => line.startsWith('worktree '));
      if (!directory) return null;
      const branch = lines.find((line) => line.startsWith('branch '));
      const head = lines.find((line) => line.startsWith('HEAD '));
      return {
        directory: directory.slice('worktree '.length),
        head: head ? head.slice('HEAD '.length) : null,
        branch: branch ? branch.slice('branch '.length).replace(/^refs\/heads\//, '') : null,
        bare: lines.includes('bare'),
        detached: lines.includes('detached'),
        locked: lines.some((line) => line === 'locked' || line.startsWith('locked ')),
        prunable: lines.some(
          (line) => line === 'prunable' || line.startsWith('prunable ')
        ),
      };
    })
    .filter(Boolean);

  return json({ ok: true, repo: repo.root, worktrees });
}

async function worktreeCreate(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'worktree_create');
  if (repo.error) return repo.error;

  const name = checkedRef(args.name, 'name', { branch: true });
  if (name.error) return name.error;
  const target = path.resolve(repo.root, '..', name.value);
  await guardPath(target, context, { tool: 'worktree_create' });

  const result = await execGit(repo.root, [
    'worktree',
    'add',
    target,
    '-b',
    name.value,
  ]);
  if (!result.ok) return failure(result);
  return json({
    ok: true,
    repo: repo.root,
    directory: target,
    branch: name.value,
    summary: commandText(result),
  });
}

async function worktreeRemove(args = {}, context = null) {
  const repo = await resolveRepo(args, context, 'worktree_remove');
  if (repo.error) return repo.error;

  const raw = String(args.directory || '').trim();
  if (!raw) return invalid('directory is required');
  const target = path.resolve(repo.root, raw);
  await guardPath(target, context, { tool: 'worktree_remove' });

  const argv = ['worktree', 'remove'];
  if (args.force === true) argv.push('--force');
  argv.push(target);
  const result = await execGit(repo.root, argv);
  if (!result.ok) return failure(result);
  return json({
    ok: true,
    repo: repo.root,
    directory: target,
    summary: commandText(result),
  });
}

module.exports = {
  gitStatus,
  gitDiff,
  gitLog,
  gitShow,
  gitBlame,
  gitBranch,
  gitCheckout,
  gitAdd,
  gitCommit,
  gitStash,
  gitFetch,
  gitPull,
  gitPush,
  gitMerge,
  gitRemote,
  gitTag,
  gitRestore,
  gitReset,
  gitRevert,
  gitCherryPick,
  worktreeList,
  worktreeCreate,
  worktreeRemove,
};
