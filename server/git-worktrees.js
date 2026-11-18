'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function git(args, cwd, timeout = 120000) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

function repoRoot(dir) {
  const target = String(dir || '').trim();
  if (!target || !fs.existsSync(target)) return null;
  const result = git(['rev-parse', '--show-toplevel'], target, 15000);
  if (result.status !== 0) return null;
  const root = String(result.stdout || '').trim();
  return root ? path.resolve(root) : null;
}

function ensureRepo(dir) {
  const target = String(dir || '').trim();
  if (!target || !fs.existsSync(target)) return null;
  const existing = repoRoot(target);
  if (existing) return existing;
  const init = git(['init'], target, 30000);
  if (init.status !== 0) {
    console.error('git init failed', target, init.stderr || init.error);
    return null;
  }
  const head = git(['rev-parse', '--verify', 'HEAD'], target, 15000);
  if (head.status !== 0) {
    git(['add', '-A'], target, 120000);
    git(
      [
        '-c',
        'user.name=YAH',
        '-c',
        'user.email=yah@local',
        'commit',
        '--allow-empty',
        '-m',
        'Initial commit (YAH)',
      ],
      target,
      120000
    );
  }
  return repoRoot(target) || path.resolve(target);
}

function slug(value, fallback = 'work') {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback
  );
}

function createGitWorktreeService({ root }) {
  const baseRoot = path.resolve(root);
  const checked = new Set();

  function ensureRepositories(directories) {
    const result = [];
    for (const directory of Array.isArray(directories) ? directories : []) {
      const target = String(directory || '').trim();
      if (!target || checked.has(target)) continue;
      checked.add(target);
      try {
        const repo = ensureRepo(target);
        if (repo) result.push(repo);
      } catch (error) {
        console.error('ensure git repository failed', target, error);
      }
    }
    return result;
  }

  function prepareWorktree({ baseDirectories, sessionId, label }) {
    const id = String(sessionId || '').trim();
    const directories = [];
    const branches = [];
    if (!id) return { directories, branches };
    for (const base of Array.isArray(baseDirectories) ? baseDirectories : []) {
      const repo = ensureRepo(base);
      if (!repo) continue;
      const baseName = path.basename(repo) || 'repo';
      const branch = `yah/${slug(label)}-${id.slice(0, 8)}`;
      const worktree = path.join(baseRoot, id, slug(baseName));
      if (fs.existsSync(worktree)) {
        directories.push(worktree);
        branches.push({ repo, branch, worktree });
        continue;
      }
      fs.mkdirSync(path.dirname(worktree), { recursive: true });
      let result = git(
        ['worktree', 'add', '-b', branch, worktree, 'HEAD'],
        repo
      );
      if (result.status !== 0) {
        result = git(['worktree', 'add', worktree, branch], repo);
      }
      if (result.status === 0) {
        directories.push(worktree);
        branches.push({ repo, branch, worktree });
      } else {
        console.error(
          'git worktree add failed',
          repo,
          result.stderr || result.error
        );
      }
    }
    return { directories, branches };
  }

  function commitWorktree(directories, message) {
    const results = [];
    for (const directory of Array.isArray(directories) ? directories : []) {
      const repo = repoRoot(directory);
      if (!repo) continue;
      const status = git(['status', '--porcelain'], repo, 30000);
      if (status.status !== 0 || !String(status.stdout || '').trim()) continue;
      git(['add', '-A'], repo, 120000);
      const commit = git(
        [
          '-c',
          'user.name=YAH',
          '-c',
          'user.email=yah@local',
          'commit',
          '-m',
          String(message || 'YAH expert changes'),
        ],
        repo,
        120000
      );
      if (commit.status === 0) results.push(repo);
    }
    return results;
  }

  function branchSummary(branches) {
    return (Array.isArray(branches) ? branches : [])
      .filter((item) => item && item.branch)
      .map((item) => (item.worktree ? `${item.branch} (${item.worktree})` : item.branch));
  }

  return {
    ensureRepo,
    ensureRepositories,
    prepareWorktree,
    commitWorktree,
    branchSummary,
  };
}

module.exports = {
  createGitWorktreeService,
  ensureRepo,
  git,
  slug,
};
