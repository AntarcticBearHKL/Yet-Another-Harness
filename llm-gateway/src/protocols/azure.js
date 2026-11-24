'use strict';

const openaiChat = require('./openai-chat');

function buildUrl({ provider, request }) {
  const base = String(provider.baseURL || '').replace(/\/+$/, '');
  const apiVersion = String(
    request.apiVersion || request.providerOptions?.apiVersion || '2024-10-21'
  );
  if (/\/openai\/v1$/.test(base)) return `${base}/chat/completions`;
  if (/\/openai\/deployments\/[^/]+$/.test(base)) {
    return `${base}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  }
  const deployment = String(
    request.deployment || request.providerOptions?.deployment || request.model
  );
  return `${base}/openai/deployments/${encodeURIComponent(
    deployment
  )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

async function send(context) {
  return openaiChat.send({
    ...context,
    url: buildUrl(context),
  });
}

module.exports = {
  id: 'azure-openai',
  buildBody: openaiChat.buildBody,
  consumeChunk: openaiChat.consumeChunk,
  send,
  buildUrl,
};
