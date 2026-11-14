'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

async function realPath(target) {
  try {
    return await fs.promises.realpath(target);
  } catch {
    const parent = path.dirname(target);
    try {
      const realParent = await fs.promises.realpath(parent);
      return path.join(realParent, path.basename(target));
    } catch {
      return target;
    }
  }
}

async function guardPath(target, context, options = {}) {
  if (!context || !context.enforceProjectRoots) return;
  const resolved = path.resolve(String(target || ''));
  const allowed = Array.isArray(context.allowedDirs)
    ? context.allowedDirs.map((dir) => path.resolve(String(dir)))
    : [];
  if (allowed.length > 0) {
    const realTarget = await realPath(resolved);
    for (const dir of allowed) {
      const realDir = await realPath(dir);
      if (isInside(realDir, realTarget)) return;
    }
  }
  if (typeof context.approve !== 'function') {
    throw new Error(`path is outside the project directories: ${resolved}`);
  }
  const tool = String(options.tool || 'file');
  const result = await context.approve({
    tool,
    path: resolved,
    allowedDirs: allowed,
  });
  if (result === true || result?.approved === true) return;
  if (result?.reason === 'cancelled') {
    throw new Error(
      `The run was cancelled while waiting for permission to access "${resolved}".`
    );
  }
  throw new Error(
    `User denied access to "${resolved}" for the ${tool} tool. The user explicitly rejected this file operation; do not assume permission. Choose a different approach or ask the user for guidance.`
  );
}

module.exports = { guardPath, isInside };
