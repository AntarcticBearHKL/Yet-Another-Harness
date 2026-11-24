'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { createGateway } = require('./gateway');
const { listProviders, resolveProvider, providerApiKey, catalogSource } = require('./catalog');
const { getJson } = require('./transport');
const { authHeaders } = require('./gateway');

const VERSION = '1.0.0';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseJsonBody(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error(`invalid JSON body: ${error.message}`), {
      status: 400,
    });
  }
}

async function listRemoteModels(providerId, request = {}) {
  const provider = resolveProvider(providerId, {
    baseURL: request.baseURL,
    env: request.env,
  });
  const apiKey = providerApiKey(provider, request);
  const headers = authHeaders(provider, apiKey);
  const base = String(provider.baseURL || '').replace(/\/+$/, '');
  if (!base) throw Object.assign(new Error('provider has no base URL'), { status: 400 });
  if (provider.protocol === 'gemini') {
    const url = `${base}/models`;
    const data = await getJson(url, { headers, signal: request.signal });
    return (data.models || []).map((model) => ({
      id: String(model.name || '').replace(/^models\//, ''),
      name: model.displayName || model.name || '',
      provider: provider.id,
      raw: model,
    }));
  }
  if (provider.protocol === 'anthropic-messages') {
    const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
    const data = await getJson(url, { headers, signal: request.signal });
    return (data.data || []).map((model) => ({
      id: model.id,
      name: model.display_name || model.id,
      provider: provider.id,
      raw: model,
    }));
  }
  const data = await getJson(`${base}/models`, { headers, signal: request.signal });
  const items = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return items.map((model) => ({
    id: String(model.id || model.name || ''),
    name: String(model.name || model.id || ''),
    provider: provider.id,
    raw: model,
  }));
}

function createServer(options = {}) {
  const gateway = createGateway(options);
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, {
          ok: true,
          version: VERSION,
          providers: listProviders().length,
          catalog: catalogSource,
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/providers') {
        const search = String(url.searchParams.get('q') || '').toLowerCase();
        const providers = listProviders().filter(
          (provider) =>
            !search ||
            provider.id.toLowerCase().includes(search) ||
            provider.name.toLowerCase().includes(search)
        );
        json(res, 200, { ok: true, providers });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const providerId = String(url.searchParams.get('provider') || '').trim();
        if (!providerId) {
          json(res, 400, { ok: false, error: 'provider is required' });
          return;
        }
        const models = await listRemoteModels(providerId, {
          apiKey: String(url.searchParams.get('apiKey') || ''),
          baseURL: String(url.searchParams.get('baseURL') || ''),
        });
        json(res, 200, { ok: true, provider: providerId, data: models });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/chat') {
        const body = await parseJsonBody(req);
        const controller = new AbortController();
        req.on('close', () => controller.abort());
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          'access-control-allow-origin': '*',
        });
        res.flushHeaders?.();
        try {
          for await (const event of gateway.stream({
            ...body,
            signal: controller.signal,
          })) {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            if (event.type === 'done' || event.type === 'error') break;
          }
        } catch (error) {
          const event = {
            type: 'error',
            error: {
              code: error.code || 'gateway_error',
              message: error.message || String(error),
              status: error.status || 0,
              details: error.details || null,
            },
          };
          res.write(`event: error\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/chat/complete') {
        const body = await parseJsonBody(req);
        const done = await gateway.chat({ ...body, stream: true });
        json(res, 200, {
          ok: true,
          provider: body.provider || options.defaultProvider || 'openai',
          model: body.model,
          message: done?.message || null,
          usage: done?.usage || null,
          finishReason: done?.finishReason || null,
        });
        return;
      }
      json(res, 404, { ok: false, error: `unknown route ${req.method} ${url.pathname}` });
    } catch (error) {
      json(res, error.status || 500, {
        ok: false,
        error: error.message || String(error),
        code: error.code || 'gateway_error',
        details: error.details || null,
      });
    }
  });
}

module.exports = {
  createServer,
  VERSION,
};
