'use strict';

// Bridge between the MCP manager (backend process) and the agent tool loop.
// MCP tools are exposed to every conversation automatically; there is no
// per-chat switch.

let provider = null;

function setProvider(value) {
  provider =
    value && typeof value === 'object' && typeof value.list === 'function'
      ? value
      : null;
}

function rawTools() {
  if (!provider) return [];
  try {
    const list = provider.list();
    return Array.isArray(list) ? list : [];
  } catch (error) {
    console.error('mcp tool provider failed', error);
    return [];
  }
}

function slug(text, max) {
  const value = String(text || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!value) return 'tool';
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function hashSuffix(text, length = 5) {
  let hash = 0;
  const value = String(text || '');
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).slice(-length).padStart(length, '0');
}

function exposedName(serverName, toolName) {
  const server = slug(serverName, 18);
  const tool = slug(toolName, 44);
  let name = `mcp__${server}__${tool}`;
  if (name.length > 64) {
    const keep = Math.max(8, 64 - `mcp__${server}__`.length - 6);
    name = `mcp__${server}__${tool.slice(0, keep)}_${hashSuffix(toolName)}`;
  }
  return name;
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }
  const out = { ...schema };
  if (!out.type) out.type = 'object';
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

function buildEntries() {
  const entries = [];
  const used = new Map();
  for (const item of rawTools()) {
    const serverName = String(item?.serverName || 'MCP');
    const tool = item?.tool || {};
    const toolName = String(tool.name || '');
    if (!toolName) continue;
    let name = exposedName(serverName, toolName);
    if (used.has(name)) {
      let index = 2;
      while (used.has(`${name}_${index}`)) index += 1;
      name = `${name}_${index}`;
    }
    used.set(name, true);
    entries.push({
      name,
      serverId: item.serverId,
      serverName,
      toolName,
      title: String(tool.title || ''),
      description: String(tool.description || ''),
      schema: normalizeSchema(tool.inputSchema),
      annotations: tool.annotations || {},
    });
  }
  return entries;
}

function definitions(options = {}) {
  const disabled = new Set(
    Array.isArray(options.disabledServerIds)
      ? options.disabledServerIds.map(String)
      : []
  );
  return buildEntries()
    .filter((entry) => !disabled.has(String(entry.serverId)))
    .map((entry) => {
      const label = entry.title
        ? `${entry.title} (${entry.toolName})`
        : entry.toolName;
      const prefix = `MCP server "${entry.serverName}" · tool "${label}".`;
      const description = entry.description
        ? `${prefix} ${entry.description}`
        : prefix;
      return {
        type: 'function',
        function: {
          name: entry.name,
          description: description.slice(0, 1024),
          parameters: entry.schema,
        },
      };
    });
}

function findEntry(name) {
  return buildEntries().find((entry) => entry.name === name) || null;
}

function isMcpTool(name) {
  return String(name || '').startsWith('mcp__');
}

async function execute(name, args) {
  const entry = findEntry(name);
  if (!entry) {
    return `tool error: unknown MCP tool "${name}"`;
  }
  if (!provider || typeof provider.callTool !== 'function') {
    return 'tool error: MCP manager is not available';
  }
  let value;
  try {
    value = JSON.parse(args || '{}');
  } catch (error) {
    return `tool error: invalid JSON arguments: ${error.message}`;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    value = {};
  }
  try {
    const result = await provider.callTool(
      entry.serverId,
      entry.toolName,
      value
    );
    if (typeof result === 'string') return result;
    if (result && typeof result.text === 'string') return result.text;
    return JSON.stringify(result ?? null, null, 2);
  } catch (error) {
    return `tool error: ${error.message}`;
  }
}

function statusLabel(name, args) {
  const entry = findEntry(name);
  if (!entry) return `tool: ${name}`;
  let value = {};
  try {
    value = JSON.parse(args || '{}');
  } catch {
    /* ignore */
  }
  const hint =
    value.path ||
    value.query ||
    value.uri ||
    value.name ||
    value.url ||
    value.prompt ||
    value.id ||
    '';
  const text = Array.from(String(hint)).slice(0, 42).join('');
  const base = `${entry.serverName} · ${entry.toolName}`;
  return text ? `${base}: ${text}` : base;
}

module.exports = {
  setProvider,
  definitions,
  execute,
  statusLabel,
  isMcpTool,
  exposedName,
  buildEntries,
  normalizeSchema,
  _test: {
    slug,
    hashSuffix,
    buildEntries,
  },
};
