'use strict';

// Tiny Streamable HTTP MCP server used by the test suite.

const http = require('node:http');

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function handle(message) {
  if (!message || typeof message !== 'object') return null;
  const { id, method, params } = message;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'yah-http-test', version: '1.0.0' },
    });
  }
  if (method === 'tools/list') {
    return reply(id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo text over HTTP.',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
    });
  }
  if (method === 'tools/call') {
    const text = String(params?.arguments?.text ?? '');
    return reply(id, {
      content: [{ type: 'text', text: `http:${text}` }],
    });
  }
  if (method === 'ping') return reply(id, {});
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

function createMcpHttpServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain' });
      res.end('standalone SSE not supported');
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let message;
      try {
        message = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { error: 'bad json' });
        return;
      }
      if (message.id === undefined || message.id === null) {
        res.writeHead(202, { 'mcp-session-id': 'test-session' });
        res.end();
        return;
      }
      const response = handle(message);
      sendJson(res, 200, response, { 'mcp-session-id': 'test-session' });
    });
  });
}

module.exports = { createMcpHttpServer };
