'use strict';

// Tiny stdio MCP server used by the test suite and manual end-to-end checks.

const readline = require('node:readline');

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const tools = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Echo the provided text back.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to echo.' },
        upper: { type: 'boolean', description: 'Uppercase the text.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'add',
    title: 'Add',
    description: 'Add two numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
  },
];

const resources = [
  {
    uri: 'test://readme',
    name: 'readme',
    title: 'Test README',
    mimeType: 'text/plain',
    description: 'A tiny text resource.',
  },
];

const prompts = [
  {
    name: 'greet',
    title: 'Greet',
    description: 'Greet someone by name.',
    arguments: [{ name: 'name', description: 'Person to greet', required: true }],
  },
];

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.id === undefined) return; // notifications/initialized
  const { id, method, params } = message;

  if (method === 'initialize') {
    reply(id, {
      protocolVersion: '2025-06-18',
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
      },
      serverInfo: { name: 'yah-test-server', version: '1.0.0' },
      instructions: 'Test server for YAH.',
    });
    return;
  }

  if (method === 'ping') {
    reply(id, {});
    return;
  }

  if (method === 'tools/list') {
    reply(id, { tools });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === 'echo') {
      if (typeof args.text !== 'string') {
        reply(id, {
          content: [{ type: 'text', text: 'text is required' }],
          isError: true,
        });
        return;
      }
      const text = args.upper ? args.text.toUpperCase() : args.text;
      reply(id, {
        content: [{ type: 'text', text }],
        structuredContent: { echoed: text },
      });
      return;
    }
    if (name === 'add') {
      const sum = Number(args.a) + Number(args.b);
      reply(id, {
        content: [{ type: 'text', text: String(sum) }],
        structuredContent: { sum },
      });
      return;
    }
    reply(id, {
      content: [{ type: 'text', text: `unknown tool: ${name}` }],
      isError: true,
    });
    return;
  }

  if (method === 'resources/list') {
    reply(id, { resources });
    return;
  }

  if (method === 'resources/templates/list') {
    reply(id, {
      resourceTemplates: [
        {
          uriTemplate: 'test://item/{id}',
          name: 'item',
          title: 'Test item',
          description: 'Resolve an item by id.',
          mimeType: 'text/plain',
        },
      ],
    });
    return;
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri || '');
    if (uri === 'test://readme' || uri.startsWith('test://item/')) {
      reply(id, {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text:
              uri === 'test://readme'
                ? 'Hello from the YAH test MCP server.'
                : `Item ${uri.slice('test://item/'.length)}`,
          },
        ],
      });
      return;
    }
    fail(id, -32002, `Resource not found: ${uri}`);
    return;
  }

  if (method === 'prompts/list') {
    reply(id, { prompts });
    return;
  }

  if (method === 'prompts/get') {
    const name = params?.name;
    if (name !== 'greet') {
      fail(id, -32602, `Unknown prompt: ${name}`);
      return;
    }
    const who = String(params?.arguments?.name || 'world');
    reply(id, {
      description: 'A greeting prompt',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Please greet ${who}.` },
        },
      ],
    });
    return;
  }

  fail(id, -32601, `Method not found: ${method}`);
});

rl.on('close', () => process.exit(0));
