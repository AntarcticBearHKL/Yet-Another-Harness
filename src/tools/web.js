'use strict';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const MAX_OUTPUT = 200_000;

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
      mdash: '—',
      ndash: '–',
      hellip: '…',
      lsquo: '‘',
      rsquo: '’',
      ldquo: '“',
      rdquo: '”',
    };
    return named[lower] ?? match;
  });
}

function htmlToText(html) {
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

function htmlToMarkdown(html) {
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
      return `\n${'#'.repeat(Number(level))} ${htmlToText(content)}\n`;
    })
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const name = htmlToText(label);
      return name ? `[${name}](${href})` : href;
    })
    .replace(/<\/(p|div|section|article|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function webfetchTool(args) {
  const raw = String(args.url || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    return 'tool error: url must start with http:// or https://';
  }
  const format = ['text', 'markdown', 'html'].includes(args.format)
    ? args.format
    : 'markdown';
  const timeout = Math.max(
    1,
    Math.min(120, Number(args.timeout) || 30)
  );
  let response;
  try {
    response = await fetch(raw, {
      headers: {
        'User-Agent': UA,
        Accept:
          format === 'html'
            ? 'text/html,application/xhtml+xml'
            : 'text/html,application/xhtml+xml,application/json,text/plain',
      },
      signal: AbortSignal.timeout(timeout * 1000),
    });
  } catch (error) {
    return `tool error: fetch failed: ${error.message}`;
  }
  if (!response.ok) {
    return `tool error: HTTP ${response.status} ${response.statusText}`;
  }
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();
  let output = rawText;
  if (format === 'html') {
    output = rawText;
  } else if (contentType.includes('html')) {
    output = format === 'text' ? htmlToText(rawText) : htmlToMarkdown(rawText);
  }
  if (output.length > MAX_OUTPUT) {
    output = `${output.slice(0, MAX_OUTPUT)}\n… truncated at ${MAX_OUTPUT} characters`;
  }
  return `${raw}\n${contentType}\n\n${output}`;
}

module.exports = { webfetchTool, htmlToText, htmlToMarkdown };
