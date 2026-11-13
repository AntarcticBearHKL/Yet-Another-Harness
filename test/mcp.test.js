'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  McpConfigStore,
  normalizeServer,
  parseConfigText,
} = require('../server/mcp/config');
const { parseJsonc, extractServerEntries } = require('../server/mcp/opencode');
const { McpClient } = require('../server/mcp/client');
const { createMcpHttpServer } = require('../test-fixtures/mcp-http-server');
const registry = require('../src/mcp-registry');
const tools = require('../src/tools');

test('normalizeServer accepts command arrays and environment maps', () => {
  const server = normalizeServer({
    name: 'demo',
    type: 'local',
    command: ['npx', '-y', '@scope/server'],
    environment: { TOKEN: 42 },
    cwd: ' D:\\Dev ',
  });
  assert.equal(server.name, 'demo');
  assert.equal(server.transport, 'stdio');
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', '@scope/server']);
  assert.deepEqual(server.env, { TOKEN: '42' });
  assert.equal(server.cwd, 'D:\\Dev');
});

test('normalizeServer accepts remote url configs', () => {
  const server = normalizeServer({
    name: 'remote',
    type: 'remote',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x' },
  });
  assert.equal(server.transport, 'http');
  assert.equal(server.url, 'https://example.com/mcp');
  assert.deepEqual(server.headers, { Authorization: 'Bearer x' });
});

test('parseConfigText reads mcpServers and mcp.servers', () => {
  const first = parseConfigText(
    JSON.stringify({
      mcpServers: {
        one: { command: 'node', args: ['one.js'] },
      },
    })
  );
  assert.equal(first.length, 1);
  assert.equal(first[0].name, 'one');
  assert.equal(first[0].command, 'node');

  const second = parseConfigText(
    JSON.stringify({
      mcp: {
        servers: {
          two: { type: 'remote', url: 'https://example.com/mcp' },
        },
      },
    })
  );
  assert.equal(second.length, 1);
  assert.equal(second[0].transport, 'http');
});

test('OpenCode JSONC and mcp.servers entries are parsed', () => {
  const data = parseJsonc(`{
    // OpenCode config with comments
    "mcp": {
      "servers": {
        "demo": {
          "type": "local",
          "command": ["node", "server.js"],
          "disabled": true,
        },
      },
    },
  }`);
  const entries = extractServerEntries(data);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'demo');
  assert.equal(entries[0].raw.disabled, true);
});

test('config store persists add / update / remove', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-mcp-'));
  try {
    const store = new McpConfigStore(dir);
    const added = store.add({ name: 'demo', command: 'node' });
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].id, added.id);

    assert.throws(
      () => store.add({ name: 'demo', command: 'node' }),
      /同名/
    );

    store.update(added.id, { name: 'demo2', url: 'https://example.com/mcp' });
    assert.equal(store.find(added.id).name, 'demo2');
    assert.equal(store.find(added.id).transport, 'http');

    const reloaded = new McpConfigStore(dir);
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.list()[0].name, 'demo2');

    assert.equal(store.remove(added.id), true);
    assert.equal(store.list().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP client speaks stdio initialize / tools / resources / prompts', { timeout: 30_000 }, async () => {
  const fixture = path.join(__dirname, '..', 'test-fixtures', 'mcp-server.js');
  const server = normalizeServer({
    name: 'test-server',
    command: process.execPath,
    args: [fixture],
  });
  const client = new McpClient(server, { version: 'test' });
  try {
    const snapshot = await client.connect();
    assert.equal(client.status, 'connected');
    assert.equal(snapshot.serverInfo.name, 'yah-test-server');
    assert.equal(client.tools.length, 2);
    assert.equal(client.resources.length, 1);
    assert.equal(client.resourceTemplates.length, 1);
    assert.equal(client.prompts.length, 1);

    const echo = await client.callTool('echo', { text: 'hello', upper: true });
    assert.equal(echo.ok, true);
    assert.equal(echo.result.content[0].text, 'HELLO');

    const resource = await client.readResource('test://readme');
    assert.equal(resource.ok, true);
    assert.match(resource.result.contents[0].text, /YAH test MCP server/);

    const prompt = await client.getPrompt('greet', { name: 'YAH' });
    assert.equal(prompt.ok, true);
    assert.match(prompt.result.messages[0].content.text, /YAH/);
  } finally {
    client.close();
  }
});

test('MCP client speaks streamable HTTP', { timeout: 30_000 }, async () => {
  const server = createMcpHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const normalized = normalizeServer({
    name: 'http-test',
    type: 'remote',
    url: `http://127.0.0.1:${port}/mcp`,
  });
  const client = new McpClient(normalized, { version: 'test' });
  try {
    await client.connect();
    assert.equal(client.status, 'connected');
    assert.equal(client.serverInfo.name, 'yah-http-test');
    assert.equal(client.tools.length, 1);
    const result = await client.callTool('echo', { text: 'ok' });
    assert.equal(result.ok, true);
    assert.equal(result.result.content[0].text, 'http:ok');
  } finally {
    client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('registry exposes MCP tools and routes calls', async () => {
  const calls = [];
  registry.setProvider({
    list: () => [
      {
        serverId: 's1',
        serverName: 'Demo Server',
        tool: {
          name: 'do.thing',
          description: 'Do a thing.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      },
    ],
    callTool: async (serverId, name, args) => {
      calls.push({ serverId, name, args });
      return { ok: true, text: `did ${name}` };
    },
  });

  try {
    const defs = tools.definitions();
    const mcpDef = defs.find((def) => def.function.name.startsWith('mcp__'));
    assert.ok(mcpDef, 'MCP tool definition is present');
    assert.match(mcpDef.function.description, /Demo Server/);
    assert.equal(mcpDef.function.parameters.required[0], 'path');

    const output = await tools.execute(
      mcpDef.function.name,
      JSON.stringify({ path: 'a.txt' })
    );
    assert.equal(output, 'did do.thing');
    assert.deepEqual(calls, [
      { serverId: 's1', name: 'do.thing', args: { path: 'a.txt' } },
    ]);

    assert.match(
      tools.statusLabel(mcpDef.function.name, JSON.stringify({ path: 'a.txt' })),
      /Demo Server · do\.thing: a\.txt/
    );
  } finally {
    registry.setProvider(null);
  }
});

test('registry reports unknown MCP tools', async () => {
  registry.setProvider({ list: () => [], callTool: async () => '' });
  try {
    assert.match(
      await tools.execute('mcp__missing__tool', '{}'),
      /unknown MCP tool/
    );
  } finally {
    registry.setProvider(null);
  }
});
