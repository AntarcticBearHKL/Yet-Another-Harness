'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGitWorktreeService } = require('../server/git-worktrees');

test('git worktrees give each expert an isolated branch', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-git-project-'));
  const worktreeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'yah-git-worktrees-')
  );
  try {
    fs.writeFileSync(path.join(project, 'README.md'), '# Demo\n');
    fs.writeFileSync(path.join(project, 'app.js'), 'console.log(1)\n');
    const git = createGitWorktreeService({ root: worktreeRoot });
    const repo = git.ensureRepo(project);
    assert.ok(repo);
    const parent = git.prepareWorktree({
      baseDirectories: [project],
      sessionId: 'parent-session-1',
      label: 'Coordinator task',
    });
    assert.equal(parent.directories.length, 1);
    assert.match(parent.branches[0].branch, /^yah\//);
    assert.ok(
      fs.existsSync(path.join(parent.directories[0], 'README.md'))
    );

    const child = git.prepareWorktree({
      baseDirectories: parent.directories,
      sessionId: 'child-session-1',
      label: 'Programmer task',
    });
    assert.equal(child.directories.length, 1);
    assert.notEqual(
      child.directories[0],
      parent.directories[0]
    );
    assert.notEqual(child.branches[0].branch, parent.branches[0].branch);
    fs.writeFileSync(
      path.join(child.directories[0], 'feature.js'),
      'export const ok = true;\n'
    );
    const committed = git.commitWorktree(
      child.directories,
      'feat: add feature'
    );
    assert.equal(committed.length, 1);
    const summary = git.branchSummary(child.branches);
    assert.match(summary[0], /^yah\//);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
});
