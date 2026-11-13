'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

// 免费 web_search：DuckDuckGo 公开 HTML 端点，不需要 API key。
// 解析 result__a / result__snippet，把 uddg= 重定向解成真实 URL。

const SEARCH_URL = 'https://html.duckduckgo.com/html/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

function definitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the public web with DuckDuckGo. Use this for current events, facts you are unsure about, ' +
          'or anything beyond your training data. Returns titles, URLs and short snippets. Free, no API key.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: "Search query, in the user's language if appropriate.",
            },
            max_results: {
              type: 'integer',
              description: 'How many results to return (1-8).',
              minimum: 1,
              maximum: 8,
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Read a UTF-8 text file from the local filesystem. Returns numbered lines. ' +
          'Use offset and limit to page through large files.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Absolute path, or a path relative to the harness working directory.',
            },
            offset: {
              type: 'integer',
              description: '1-based line number to start from.',
              minimum: 1,
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of lines to return (1-2000).',
              minimum: 1,
              maximum: 2000,
            },
          },
          required: ['path'],
        },
      },
    },
  ];
}

async function execute(name, args) {
  let value;
  try {
    value = JSON.parse(args || '{}');
  } catch (error) {
    return `tool error: invalid JSON arguments: ${error.message}`;
  }
  if (!value || typeof value !== 'object') value = {};

  if (name === 'web_search') {
    const query = String(value.query ?? '').trim();
    if (!query) {
      return 'tool error: web_search requires a non-empty "query"';
    }
    const max = Math.max(1, Math.min(8, Number(value.max_results) || 5));
    try {
      return await webSearch(query, max);
    } catch (error) {
      return `tool error: ${error.message}`;
    }
  }

  if (name === 'read_file') {
    try {
      return await readFileTool(value);
    } catch (error) {
      return `tool error: ${error.message}`;
    }
  }

  return `tool error: unknown tool "${name}"`;
}

function statusLabel(name, args) {
  let value = {};
  try {
    value = JSON.parse(args || '{}');
  } catch {
    /* ignore */
  }
  if (name === 'web_search') {
    const query = Array.from(String(value.query ?? '')).slice(0, 48).join('');
    return query ? `web_search: ${query}` : 'web_search';
  }
  if (name === 'read_file') {
    const filePath = String(value.path ?? '');
    const base = filePath ? path.basename(filePath) : '';
    return base ? `read_file: ${base}` : 'read_file';
  }
  return `tool: ${name}`;
}

async function readFileTool(value) {
  const rawPath = String(value.path ?? '').trim();
  if (!rawPath) {
    return 'tool error: read_file requires a non-empty "path"';
  }
  const abs = path.resolve(rawPath);
  const offset = Math.max(1, Number(value.offset) || 1);
  const limit = Math.max(1, Math.min(2000, Number(value.limit) || 200));

  let stat;
  try {
    stat = await fs.promises.stat(abs);
  } catch (error) {
    return `tool error: cannot read "${rawPath}": ${error.code || error.message}`;
  }
  if (!stat.isFile()) {
    return `tool error: "${rawPath}" is not a file`;
  }

  try {
    const handle = await fs.promises.open(abs, 'r');
    try {
      const sample = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      if (sample.subarray(0, bytesRead).includes(0)) {
        return `tool error: "${rawPath}" looks like a binary file`;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    return `tool error: cannot read "${rawPath}": ${error.code || error.message}`;
  }

  const stream = fs.createReadStream(abs, { encoding: 'utf8' });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  const output = [];
  const MAX_LINE = 4000;
  const MAX_CHARS = 100_000;
  let chars = 0;
  let lineNo = 0;
  let truncated = false;

  try {
    for await (const rawLine of lines) {
      lineNo += 1;
      if (lineNo < offset) continue;
      if (output.length >= limit) {
        truncated = true;
        break;
      }
      let line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, '') : rawLine;
      if (line.length > MAX_LINE) {
        line = `${line.slice(0, MAX_LINE - 1)}…`;
      }
      if (chars + line.length > MAX_CHARS) {
        truncated = true;
        break;
      }
      output.push(`${lineNo}: ${line}`);
      chars += line.length + 1;
    }
  } catch (error) {
    return `tool error: cannot read "${rawPath}": ${error.code || error.message}`;
  } finally {
    lines.close();
    stream.destroy();
  }

  if (output.length === 0) {
    if (lineNo === 0) {
      return `${abs}\n(empty file)`;
    }
    if (offset > lineNo) {
      return `tool error: offset ${offset} is beyond end of file (${lineNo} lines)`;
    }
    return `tool error: no lines at offset ${offset}`;
  }

  const last = offset + output.length - 1;
  let result = `${abs}\n${output.join('\n')}`;
  if (truncated) {
    result += `\n… truncated at line ${last}; use offset=${last + 1} to continue`;
  }
  return result;
}

async function webSearch(query, max) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const html = await response.text();
  if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo too')) {
    throw new Error('DuckDuckGo blocked this search (rate limit/CAPTCHA). Try again later.');
  }

  const results = parseResults(html, max);
  if (results.length === 0) {
    return `No web results found for "${query}".`;
  }

  let out = `Web search results for "${query}":\n`;
  results.forEach((result, index) => {
    out += `${index + 1}. ${result.title}\n   ${result.url}\n`;
    if (result.snippet) {
      out += `   ${truncate(result.snippet, 400)}\n`;
    }
  });
  return out;
}

function parseResults(html, max) {
  const results = [];
  const parts = String(html).split('class="result__a"').slice(1);

  for (const part of parts) {
    if (results.length >= max) break;

    const href = extractBetween(part, 'href="', '"');
    const title = extractBetween(part, '>', '</a>');
    const snippetAt = part.indexOf('class="result__snippet"');
    const snippet =
      snippetAt >= 0
        ? extractBetween(part.slice(snippetAt), '>', '</a>') || ''
        : '';

    if (!href || !title || !title.trim()) continue;

    results.push({
      title: cleanHtml(title),
      url: decodeDdgUrl(decodeEntities(href)),
      snippet: cleanHtml(snippet),
    });
  }
  return results;
}

function extractBetween(text, start, end) {
  const at = text.indexOf(start);
  if (at < 0) return null;
  const from = at + start.length;
  const to = text.indexOf(end, from);
  if (to < 0) return null;
  return text.slice(from, to);
}

const NAMED_ENTITIES = {
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
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  deg: '°',
  times: '×',
  divide: '÷',
};

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
    return NAMED_ENTITIES[lower] ?? match;
  });
}

function cleanHtml(fragment) {
  return decodeEntities(String(fragment).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeDdgUrl(href) {
  const raw = String(href).trim();
  try {
    const url = new URL(raw, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return target;
    return url.toString();
  } catch {
    return raw.startsWith('//') ? `https:${raw}` : raw;
  }
}

function truncate(text, max) {
  const chars = Array.from(String(text));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}…`;
}

module.exports = {
  SEARCH_URL,
  definitions,
  execute,
  statusLabel,
  webSearch,
  // 供 node --test 使用
  _test: {
    parseResults,
    decodeEntities,
    decodeDdgUrl,
    cleanHtml,
    truncate,
  },
};
