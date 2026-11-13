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
  const approved = await context.approve({
    tool: String(options.tool || 'file'),
    path: resolved,
    allowedDirs: allowed,
  });
  if (!approved) {
    throw new Error('access denied by user');
  }
}

module.exports = { guardPath, isInside };
