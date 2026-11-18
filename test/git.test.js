'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tools = require('../src/tools');
const {
  GIT_TOOLS,
  mergedDefinitions,
} = require('../src/tools/definitions');
const {
  TOOL_GROUPS,
  GIT_TOOL_NAMES,
  toolGroupFor,
} = require('../src/tool-groups');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function execute(name, repoDir, args = {}, allowedDirs = [repoDir]) {
  return tools.execute(
    name,
    JSON.stringify({ repoDir, ...args }),
    { allowedDirs, enforceProjectRoots: true }
  );
}

async function json(name, repoDir, args = {}, allowedDirs = [repoDir]) {
  const output = await execute(name, repoDir, args, allowedDirs);
  return JSON.parse(output);
}

function createRepo(root, name = 'repo') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Tester');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha\nbeta\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
}

async function withRepo(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-git-'));
  try {
    return await callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('git tools are registered and grouped under the Git category', () => {
  const names = mergedDefinitions().map((entry) => entry.function.name);
  assert.equal(new Set(names).size, names.length);
  for (const definition of GIT_TOOLS) {
    assert.ok(
      names.includes(definition.function.name),
      `missing definition: ${definition.function.name}`
    );
  }
  for (const name of GIT_TOOL_NAMES) {
    assert.equal(toolGroupFor({ name }).id, 'git', `${name} is not in Git`);
  }
  assert.equal(toolGroupFor({ name: 'patch' }).id, 'git');
  const group = TOOL_GROUPS.find((item) => item.id === 'git');
  assert.ok(group);
  assert.equal(group.label, 'Git');
  assert.equal(group.hidden, undefined);
  assert.equal(
    TOOL_GROUPS.find((item) => item.id === 'agile').label,
    'Agile'
  );
  assert.equal(TOOL_GROUPS.find((item) => item.id === 'view').label, '交互');
  assert.equal(TOOL_GROUPS.find((item) => item.id === 'search').label, '网络');
  assert.equal(
    TOOL_GROUPS.find((item) => item.id === 'background').label,
    '任务'
  );
  assert.equal(
    TOOL_GROUPS.find((item) => item.id === 'subagent').label,
    'subagent'
  );
  assert.deepEqual(
    TOOL_GROUPS.filter((item) => !item.hidden).map((item) => item.id),
    [
      'system',
      'file',
      'search',
      'git',
      'view',
      'background',
      'subagent',
      'agile',
      'session',
      'canvas',
    ]
  );
  assert.equal(TOOL_GROUPS.find((item) => item.id === 'session').label, '会话');
  assert.equal(TOOL_GROUPS.find((item) => item.id === 'canvas').label, '画布');
  assert.equal(toolGroupFor({ name: 'question' }).id, 'view');
  assert.ok(!TOOL_GROUPS.some((item) => item.id === 'browser'));
  assert.equal(toolGroupFor({ name: 'chrome' }).id, 'view');
  assert.equal(toolGroupFor({ name: 'worknode_create' }).id, 'canvas');
  assert.equal(toolGroupFor({ name: 'worknode_close' }).id, 'canvas');
  assert.equal(toolGroupFor({ name: 'worknode_create' }).label, '画布');
  const push = GIT_TOOLS.find(
    (definition) => definition.function.name === 'git_push'
  );
  assert.ok(!push.function.parameters.properties.force, 'push never force');
});

test('git status, diff, add, commit, log, show and blame are structured', async () => {
  await withRepo(async (root) => {
    const dir = createRepo(root);
    const context = [root];

    const clean = await json('git_status', dir, {}, context);
    assert.equal(clean.ok, true);
    assert.equal(clean.branch, 'main');
    assert.equal(clean.clean, true);

    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha\nbeta\ngamma\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'untracked\n');
    const dirty = await json('git_status', dir, {}, context);
    assert.equal(dirty.clean, false);
    assert.equal(dirty.unstaged[0].path, 'a.txt');
    assert.equal(dirty.untracked[0].path, 'b.txt');

    const diff = await json('git_diff', dir, {}, context);
    assert.equal(diff.ok, true);
    assert.equal(diff.files[0].path, 'a.txt');
    assert.equal(diff.files[0].additions, 1);
    assert.match(diff.patch, /\+gamma/);

    const staged = await json('git_add', dir, { paths: ['a.txt'] }, context);
    assert.equal(staged.staged[0].path, 'a.txt');

    const commit = await json(
      'git_commit',
      dir,
      { message: 'add gamma' },
      context
    );
    assert.equal(commit.ok, true);
    assert.match(commit.commit.hash, /^[0-9a-f]{40}$/);
    assert.equal(commit.commit.subject, 'add gamma');
    assert.equal(commit.totals.insertions, 1);

    const log = await json('git_log', dir, { limit: 5 }, context);
    assert.equal(log.commits[0].subject, 'add gamma');
    assert.equal(log.commits[1].subject, 'initial');

    const show = await json('git_show', dir, { rev: 'HEAD' }, context);
    assert.equal(show.commit.subject, 'add gamma');
    assert.match(show.patch, /\+gamma/);

    const blame = await json('git_blame', dir, { path: 'a.txt' }, context);
    assert.equal(blame.lines.length, 3);
    assert.equal(blame.lines[2].text, 'gamma');
    assert.equal(blame.lines[2].author, 'Tester');
  });
});

test('git branches, checkout, stash, tags and remotes work with safe deletion', async () => {
  await withRepo(async (root) => {
    const dir = createRepo(root);
    const context = [root];

    const created = await json(
      'git_branch',
      dir,
      { action: 'create', name: 'feature' },
      context
    );
    assert.equal(created.ok, true);
    assert.ok(created.branches.some((branch) => branch.name === 'feature'));

    const checkout = await json(
      'git_checkout',
      dir,
      { target: 'feature' },
      context
    );
    assert.equal(checkout.branch, 'feature');

    fs.appendFileSync(path.join(dir, 'a.txt'), 'delta\n');
    const stashed = await json(
      'git_stash',
      dir,
      { action: 'push', message: 'wip' },
      context
    );
    assert.equal(stashed.stashes.length, 1);
    assert.equal((await json('git_status', dir, {}, context)).clean, true);

    const popped = await json(
      'git_stash',
      dir,
      { action: 'pop', index: 0 },
      context
    );
    assert.equal(popped.unstaged, 1);

    const tag = await json(
      'git_tag',
      dir,
      { action: 'create', name: 'v1', message: 'version 1' },
      context
    );
    assert.equal(tag.tags[0].name, 'v1');
    assert.match(
      await execute('git_tag', dir, { action: 'delete', name: 'v1' }, context),
      /tool error/
    );
    assert.equal(
      (await json('git_tag', dir, { action: 'delete', name: 'v1', confirm: true }, context))
        .tags.length,
      0
    );

    const remote = await json(
      'git_remote',
      dir,
      { action: 'add', name: 'origin', url: 'https://example.com/a.git' },
      context
    );
    assert.equal(remote.remotes[0].fetch, 'https://example.com/a.git');
    const changed = await json(
      'git_remote',
      dir,
      {
        action: 'setUrl',
        name: 'origin',
        url: 'https://example.com/b.git',
      },
      context
    );
    assert.equal(changed.action, 'setUrl');
    assert.equal(changed.remotes[0].push, 'https://example.com/b.git');

    assert.match(
      await execute(
        'git_branch',
        dir,
        { action: 'delete', name: 'feature' },
        context
      ),
      /tool error/
    );
    assert.match(
      await execute(
        'git_branch',
        dir,
        { action: 'delete', name: 'feature', confirm: true },
        context
      ),
      /tool error/,
      'the current branch cannot be deleted'
    );
    const renamed = await json(
      'git_branch',
      dir,
      { action: 'rename', name: 'feature', newName: 'topic' },
      context
    );
    assert.equal(renamed.branch, 'topic');
  });
});

test('git destructive tools require confirmation', async () => {
  await withRepo(async (root) => {
    const dir = createRepo(root);
    const context = [root];

    fs.appendFileSync(path.join(dir, 'a.txt'), 'dirty\n');
    assert.match(
      await execute('git_restore', dir, { paths: ['a.txt'] }, context),
      /confirm/
    );
    const restored = await json(
      'git_restore',
      dir,
      { paths: ['a.txt'], confirm: true },
      context
    );
    assert.equal(restored.clean, true);

    assert.match(
      await execute('git_reset', dir, { mode: 'hard' }, context),
      /confirm/
    );
    assert.equal(
      (await json('git_reset', dir, { mode: 'hard', confirm: true }, context))
        .mode,
      'hard'
    );

    assert.match(
      await execute('git_commit', dir, { message: 'empty' }, context),
      /nothing is staged/
    );

    fs.appendFileSync(path.join(dir, 'a.txt'), 'stash me\n');
    await json('git_stash', dir, { action: 'push' }, context);
    assert.match(
      await execute('git_stash', dir, { action: 'drop' }, context),
      /confirm/
    );
    assert.equal(
      (await json('git_stash', dir, { action: 'drop', confirm: true }, context))
        .stashes.length,
      0
    );
  });
});

test('git push, fetch and pull work against a local bare remote', async () => {
  await withRepo(async (root) => {
    const dir = createRepo(root);
    const bare = path.join(root, 'remote.git');
    git(root, 'init', '--bare', '-q', bare);
    const context = [root];
    const remoteUrl = bare.replace(/\\/g, '/');

    await json(
      'git_remote',
      dir,
      { action: 'add', name: 'origin', url: remoteUrl },
      context
    );
    const pushed = await json(
      'git_push',
      dir,
      { remote: 'origin', branch: 'main', setUpstream: true },
      context
    );
    assert.equal(pushed.ok, true);
    assert.equal(pushed.rejected, false);

    const clone = path.join(root, 'clone');
    git(root, 'clone', '-q', '-b', 'main', remoteUrl, clone);
    git(clone, 'config', 'user.email', 'test@example.com');
    git(clone, 'config', 'user.name', 'Tester');
    fs.writeFileSync(path.join(clone, 'remote.txt'), 'remote\n');
    git(clone, 'add', 'remote.txt');
    git(clone, 'commit', '-qm', 'remote change');
    git(clone, 'push', '-q', 'origin', 'main');

    const fetched = await json(
      'git_fetch',
      dir,
      { remote: 'origin' },
      context
    );
    assert.equal(fetched.ok, true);

    const pulled = await json(
      'git_pull',
      dir,
      { remote: 'origin', branch: 'main' },
      context
    );
    assert.equal(pulled.ok, true);
    assert.equal(fs.existsSync(path.join(dir, 'remote.txt')), true);
  });
});

test('git worktree tools create, list and remove a worktree', async () => {
  await withRepo(async (root) => {
    const dir = createRepo(root);
    const context = [root];
    const created = await json(
      'worktree_create',
      dir,
      { name: 'wt-one' },
      context
    );
    assert.equal(created.ok, true);

    const listed = await json('worktree_list', dir, {}, context);
    assert.ok(
      listed.worktrees.some(
        (worktree) =>
          path.resolve(worktree.directory) === path.resolve(created.directory)
      )
    );

    const removed = await json(
      'worktree_remove',
      dir,
      { directory: created.directory },
      context
    );
    assert.equal(removed.ok, true);
  });
});
