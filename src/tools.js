'use strict';

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
  ];
}

async function execute(name, args) {
  if (name !== 'web_search') {
    return `tool error: unknown tool "${name}"`;
  }

  let value;
  try {
    value = JSON.parse(args || '{}');
  } catch (error) {
    return `tool error: invalid JSON arguments: ${error.message}`;
  }

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

function statusLabel(name, args) {
  if (name !== 'web_search') return `tool: ${name}`;
  let query = '';
  try {
    query = String(JSON.parse(args || '{}').query ?? '');
  } catch {
    /* ignore */
  }
  query = Array.from(query).slice(0, 48).join('');
  return query ? `web_search: ${query}` : 'web_search';
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
