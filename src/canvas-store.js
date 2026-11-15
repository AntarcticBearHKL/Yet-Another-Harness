'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const MIN_NODE_WIDTH = 220;
const MAX_NODE_WIDTH = 900;
const MIN_NODE_HEIGHT = 40;
const MAX_NODE_HEIGHT = 2000;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeView(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    x: number(source.x, 0),
    y: number(source.y, 0),
    k: clamp(number(source.k, 1), MIN_ZOOM, MAX_ZOOM),
  };
}

function normalizeNode(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    x: number(source.x, 0),
    y: number(source.y, 0),
    width: clamp(
      number(source.width, 280),
      MIN_NODE_WIDTH,
      MAX_NODE_WIDTH
    ),
    height: clamp(
      number(source.height, 170),
      MIN_NODE_HEIGHT,
      MAX_NODE_HEIGHT
    ),
    parentSessionId: source.parentSessionId
      ? String(source.parentSessionId)
      : null,
  };
}

function normalizeWires(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((wire) => {
      if (!wire || typeof wire !== 'object') return null;
      const from = String(wire.from || '');
      const to = String(wire.to || '');
      if (!from || !to) return null;
      return {
        id: String(wire.id || `${from}->${to}`),
        from,
        to,
        kind: String(wire.kind || 'subagent'),
      };
    })
    .filter(Boolean)
    .slice(0, 1000);
}

function normalizeCanvas(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const nodes = {};
  if (source.nodes && typeof source.nodes === 'object') {
    for (const [id, node] of Object.entries(source.nodes)) {
      const key = String(id || '').trim();
      if (!key) continue;
      nodes[key] = normalizeNode(node);
    }
  }
  return {
    version: 1,
    view: normalizeView(source.view),
    nodes,
    wires: normalizeWires(source.wires),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createCanvasStore(file) {
  let data = null;

  function empty() {
    return {
      version: 1,
      view: { x: 0, y: 0, k: 1 },
      nodes: {},
      wires: [],
    };
  }

  function persist() {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, file);
  }

  function load() {
    if (data) return data;
    try {
      data = normalizeCanvas(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      data = empty();
      persist();
    }
    return data;
  }

  function state() {
    load();
    return clone(data);
  }

  function save(next) {
    data = normalizeCanvas(next);
    persist();
    return clone(data);
  }

  return { file, load, state, save };
}

module.exports = {
  createCanvasStore,
  normalizeCanvas,
  normalizeView,
  normalizeNode,
};
