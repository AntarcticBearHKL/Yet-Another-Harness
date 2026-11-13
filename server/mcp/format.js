'use strict';

// Convert MCP payloads into plain text for the model and for the
// "insert into conversation" action.

const MAX_TEXT = 120_000;

function truncateText(text, max = MAX_TEXT) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`;
}

function contentBlockToText(block) {
  if (block == null) return '';
  if (typeof block === 'string') return block;
  if (typeof block !== 'object') return String(block);
  const type = String(block.type || '');
  if (type === 'text') return String(block.text ?? '');
  if (type === 'image') {
    return `[image${block.mimeType ? ` ${block.mimeType}` : ''}]`;
  }
  if (type === 'audio') {
    return `[audio${block.mimeType ? ` ${block.mimeType}` : ''}]`;
  }
  if (type === 'resource') {
    const resource = block.resource || {};
    const uri = resource.uri ? ` (${resource.uri})` : '';
    if (typeof resource.text === 'string') return `${resource.text}${uri}`;
    if (resource.blob) {
      return `[binary resource${resource.mimeType ? ` ${resource.mimeType}` : ''}${uri}]`;
    }
    return `[resource${uri}]`;
  }
  if (type === 'resource_link') {
    const name = block.name || block.title || 'resource';
    return `[${name}] ${block.uri || ''}`.trim();
  }
  if (typeof block.text === 'string') return block.text;
  try {
    return JSON.stringify(block);
  } catch {
    return String(block);
  }
}

function contentBlocksToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => contentBlockToText(block))
    .filter((text) => text !== '')
    .join('\n\n');
}

function payloadToText(payload) {
  if (payload == null) return '';
  let text = contentBlocksToText(payload.content);
  if (!text && payload.structuredContent !== undefined) {
    text = JSON.stringify(payload.structuredContent, null, 2);
  }
  if (!text) {
    try {
      text = JSON.stringify(payload, null, 2);
    } catch {
      text = String(payload);
    }
  }
  return truncateText(text);
}

function formatToolResult(response) {
  if (!response || !response.ok) {
    return truncateText(
      `tool error: ${response?.error || 'MCP tool call failed'}`
    );
  }
  const payload = response.result;
  let text = payloadToText(payload);
  if (payload && payload.isError) {
    return truncateText(`tool error: ${text || 'MCP tool returned isError'}`);
  }
  if (!text) text = 'MCP tool returned no content.';
  return text;
}

function formatResourceResult(response) {
  if (!response || !response.ok) {
    return truncateText(
      `resource error: ${response?.error || 'MCP resource read failed'}`
    );
  }
  const contents = response.result?.contents;
  if (!Array.isArray(contents) || contents.length === 0) {
    return payloadToText(response.result) || 'MCP resource returned no contents.';
  }
  const parts = [];
  for (const item of contents) {
    const uri = item?.uri || response.uri || '';
    const mime = item?.mimeType ? ` · ${item.mimeType}` : '';
    if (uri) parts.push(`# ${uri}${mime}`);
    if (typeof item?.text === 'string') {
      parts.push(item.text);
    } else if (item?.blob) {
      parts.push(
        `[binary content${item.mimeType ? ` ${item.mimeType}` : ''}, ${item.blob.length} base64 chars]`
      );
    } else {
      parts.push(contentBlockToText(item));
    }
  }
  return truncateText(parts.join('\n\n'));
}

function promptMessageText(message) {
  const content = Array.isArray(message?.content)
    ? message.content
    : [message?.content];
  return content
    .map((block) => contentBlockToText(block))
    .filter(Boolean)
    .join('\n\n');
}

function formatPromptResult(response) {
  if (!response || !response.ok) {
    return truncateText(
      `prompt error: ${response?.error || 'MCP prompt request failed'}`
    );
  }
  const result = response.result || {};
  const parts = [];
  if (result.description) parts.push(String(result.description));
  const messages = Array.isArray(result.messages) ? result.messages : [];
  for (const message of messages) {
    const text = promptMessageText(message);
    if (!text) continue;
    parts.push(`${message.role || 'user'}: ${text}`);
  }
  if (parts.length === 0) {
    parts.push(payloadToText(result) || 'MCP prompt returned no messages.');
  }
  return truncateText(parts.join('\n\n'));
}

module.exports = {
  MAX_TEXT,
  truncateText,
  contentBlockToText,
  contentBlocksToText,
  payloadToText,
  formatToolResult,
  formatResourceResult,
  formatPromptResult,
  promptMessageText,
};
