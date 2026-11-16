'use strict';

(function () {

/*
 * Lightweight, dependency-free code structure parser for the viewer.
 * It is intentionally not a compiler: it finds the symbols and foldable
 * blocks a reader needs, and stays quiet when it cannot be sure.
 *
 * Supported for now: Python, JavaScript, TypeScript (including JSX/TSX).
 */

const LANG_BY_EXT = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  pyw: 'python',
  json: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
};

function languageFor(filePath) {
  const ext = String(filePath || '')
    .split('.')
    .pop()
    .toLowerCase();
  return LANG_BY_EXT[ext] || '';
}

function detectLanguage(filePath, text) {
  const mapped = languageFor(filePath);
  if (mapped) return mapped;
  const sample = String(text || '').slice(0, 8000);
  if (
    /^\s*(?:async\s+)?def\s+[A-Za-z_]\w*|^\s*class\s+[A-Za-z_]\w*.*:/m.test(
      sample
    ) ||
    /^\s*(?:from\s+[A-Za-z_.]\w*\s+import|import\s+[A-Za-z_.]\w*)/m.test(
      sample
    )
  ) {
    return 'python';
  }
  if (
    /\binterface\s+[A-Za-z_$]\w*|\btype\s+[A-Za-z_$]\w*\s*=|:\s*(?:string|number|boolean|any|unknown|void)\b/.test(
      sample
    )
  ) {
    return 'typescript';
  }
  if (/\b(?:function|const|let|var|class)\b/.test(sample)) {
    return 'javascript';
  }
  return '';
}

function isJsLike(language) {
  return (
    language === 'javascript' ||
    language === 'jsx' ||
    language === 'typescript' ||
    language === 'tsx'
  );
}

function indentWidth(line) {
  let width = 0;
  for (const ch of String(line || '')) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAtOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(0, high);
}

/**
 * Scan JS/TS braces while ignoring strings and comments. The parser only
 * needs brace pairs and the depth/paren depth at each `{`, so it deliberately
 * skips template expressions and regex literals rather than pretending to be
 * a full tokenizer.
 */
function scanJs(text) {
  const starts = lineStarts(text);
  const pairs = new Map();
  const openParenDepth = new Map();
  const openDepth = new Map();
  const openOrder = [];
  const lineDepth = new Array(starts.length).fill(0);
  const stack = [];
  let depth = 0;
  let paren = 0;
  let lineIndex = 0;
  let state = 'normal';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '\n') {
      lineIndex += 1;
      lineDepth[lineIndex] = depth;
      if (
        state === 'lineComment' ||
        state === 'single' ||
        state === 'double'
      ) {
        state = 'normal';
      }
      continue;
    }

    if (state === 'lineComment') continue;
    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        state = 'normal';
        i += 1;
      }
      continue;
    }
    if (state === 'single' || state === 'double') {
      if (ch === '\\') i += 1;
      else if (
        (state === 'single' && ch === "'") ||
        (state === 'double' && ch === '"')
      ) {
        state = 'normal';
      }
      continue;
    }
    if (state === 'template') {
      if (ch === '\\') i += 1;
      else if (ch === '`') state = 'normal';
      continue;
    }

    if (ch === '/' && next === '/') {
      state = 'lineComment';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'blockComment';
      i += 1;
      continue;
    }
    if (ch === "'") {
      state = 'single';
      continue;
    }
    if (ch === '"') {
      state = 'double';
      continue;
    }
    if (ch === '`') {
      state = 'template';
      continue;
    }
    if (ch === '(') {
      paren += 1;
      continue;
    }
    if (ch === ')') {
      paren = Math.max(0, paren - 1);
      continue;
    }
    if (ch === '{') {
      stack.push(i);
      openOrder.push(i);
      openParenDepth.set(i, paren);
      openDepth.set(i, depth);
      depth += 1;
      continue;
    }
    if (ch === '}') {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, i);
      depth = Math.max(0, depth - 1);
    }
  }

  return {
    starts,
    pairs,
    openParenDepth,
    openDepth,
    openOrder,
    lineDepth,
  };
}

function findBodyOpen(scan, text, lineIndex, maxLines = 12, stopAtSemicolon = false) {
  const fromOffset = scan.starts[lineIndex] ?? 0;
  const maxOffset =
    scan.starts[
      Math.min(scan.starts.length - 1, lineIndex + maxLines + 1)
    ] ?? text.length;
  let semicolon = -1;
  if (stopAtSemicolon) {
    const lineEnd =
      scan.starts[lineIndex + 1] ?? text.length;
    const lineText = text.slice(fromOffset, lineEnd);
    const at = lineText.indexOf(';');
    if (at >= 0) semicolon = fromOffset + at;
  }

  for (const open of scan.openOrder) {
    if (open < fromOffset || open > maxOffset) continue;
    if (semicolon >= 0 && open > semicolon) break;
    if ((scan.openParenDepth.get(open) ?? 0) !== 0) continue;
    const close = scan.pairs.get(open);
    if (close === undefined) continue;
    return {
      open,
      close,
      endLine: lineAtOffset(scan.starts, close) + 1,
      bodyDepth: (scan.openDepth.get(open) ?? 0) + 1,
    };
  }
  return null;
}

const JS_KEYWORD_BLACKLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'new',
  'do',
  'else',
  'try',
  'finally',
  'throw',
  'await',
  'yield',
  'delete',
  'typeof',
  'void',
  'class',
  'export',
  'import',
  'const',
  'let',
  'var',
  'interface',
  'type',
  'enum',
  'namespace',
  'case',
  'default',
  'break',
  'continue',
  'super',
  'this',
]);

function jsImportFor(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
    return null;
  }
  let match = trimmed.match(
    /^import\s+(?:type\s+)?(?:.*?\s+from\s+)?['"]([^'"]+)['"]/
  );
  if (match) return match[1];
  match = trimmed.match(
    /^export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/
  );
  if (match) return match[1];
  match = trimmed.match(
    /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/
  );
  if (match) return match[1];
  return null;
}

function parseJs(text, language) {
  const lines = text.split('\n');
  const scan = scanJs(text);
  const symbols = [];
  const imports = [];
  const seen = new Set();

  function addSymbol(entry) {
    const key = `${entry.startLine}:${entry.name}:${entry.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push(entry);
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const importPath = jsImportFor(line);
    if (importPath) {
      imports.push({
        name: importPath,
        line: i + 1,
        kind: 'import',
      });
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    let match = trimmed.match(
      /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/
    );
    if (match) {
      const body = findBodyOpen(scan, text, i);
      addSymbol({
        name: match[1],
        kind: 'class',
        startLine: i + 1,
        endLine: body?.endLine ?? i + 1,
        bodyDepth: body?.bodyDepth ?? null,
      });
      continue;
    }

    match = trimmed.match(
      /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/
    );
    if (match) {
      const kind = match[1] === 'interface' || match[1] === 'type' ? 'type' : match[1];
      const body = findBodyOpen(
        scan,
        text,
        i,
        kind === 'type' ? 5 : 12,
        kind === 'type'
      );
      addSymbol({
        name: match[2],
        kind,
        startLine: i + 1,
        endLine: body?.endLine ?? i + 1,
        bodyDepth: body?.bodyDepth ?? null,
      });
      continue;
    }

    match = trimmed.match(
      /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/
    );
    if (match) {
      const body = findBodyOpen(scan, text, i);
      addSymbol({
        name: match[1],
        kind: 'function',
        startLine: i + 1,
        endLine: body?.endLine ?? i + 1,
        bodyDepth: body?.bodyDepth ?? null,
      });
      continue;
    }

    match = trimmed.match(
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/
    );
    if (match) {
      const body = findBodyOpen(scan, text, i);
      addSymbol({
        name: match[1],
        kind: 'function',
        startLine: i + 1,
        endLine: body?.endLine ?? i + 1,
        bodyDepth: body?.bodyDepth ?? null,
      });
    }
  }

  // Class members are only read at the class body's own brace depth, so
  // calls and nested functions inside method bodies never become methods.
  for (const symbol of symbols.slice()) {
    if (symbol.kind !== 'class' || symbol.bodyDepth === null) continue;
    for (let i = symbol.startLine; i < symbol.endLine; i += 1) {
      if (scan.lineDepth[i] !== symbol.bodyDepth) continue;
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
        continue;
      }

      let match = trimmed.match(
        /^(?:(?:public|private|protected|static|readonly|abstract|override|async|get|set|declare)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/
      );
      if (match && !JS_KEYWORD_BLACKLIST.has(match[1])) {
        const body = findBodyOpen(scan, text, i);
        addSymbol({
          name: match[1],
          kind: 'method',
          startLine: i + 1,
          endLine: body?.endLine ?? i + 1,
          bodyDepth: body?.bodyDepth ?? null,
        });
        continue;
      }

      match = trimmed.match(
        /^(?:(?:public|private|protected|static|readonly|abstract|override|async)\s+)*([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/
      );
      if (match && !JS_KEYWORD_BLACKLIST.has(match[1])) {
        const body = findBodyOpen(scan, text, i);
        addSymbol({
          name: match[1],
          kind: 'method',
          startLine: i + 1,
          endLine: body?.endLine ?? i + 1,
          bodyDepth: body?.bodyDepth ?? null,
        });
      }
    }
  }

  assignDepth(symbols);
  return {
    language,
    symbols: symbols.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name)),
    imports,
    foldRanges: foldRangesFor(symbols),
  };
}

function pythonBlockEnd(lines, startIndex, startIndent) {
  let end = startIndex;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (indentWidth(line) <= startIndent) break;
    end = i;
  }
  return end;
}

function parsePython(text, language) {
  const lines = text.split('\n');
  const symbols = [];
  const imports = [];
  let decoratorStart = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('@')) {
      if (decoratorStart === null) decoratorStart = i + 1;
      continue;
    }
    if (trimmed.startsWith('#')) continue;

    let match = trimmed.match(/^import\s+(.+)$/);
    if (match) {
      imports.push({ name: match[1].trim(), line: i + 1, kind: 'import' });
      decoratorStart = null;
      continue;
    }
    match = trimmed.match(/^from\s+([A-Za-z_.]\w*)\s+import\s+(.+)$/);
    if (match) {
      imports.push({
        name: `${match[1]} → ${match[2].trim()}`,
        line: i + 1,
        kind: 'import',
      });
      decoratorStart = null;
      continue;
    }

    match = trimmed.match(/^class\s+([A-Za-z_]\w*)\s*(?:\(|:)/);
    if (match) {
      const startLine = decoratorStart ?? i + 1;
      const indent = indentWidth(line);
      const endLine = pythonBlockEnd(lines, i, indent) + 1;
      symbols.push({
        name: match[1],
        kind: 'class',
        startLine,
        endLine,
        indent,
      });
      decoratorStart = null;
      continue;
    }

    match = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (match) {
      const startLine = decoratorStart ?? i + 1;
      const indent = indentWidth(line);
      const endLine = pythonBlockEnd(lines, i, indent) + 1;
      symbols.push({
        name: match[1],
        kind: indent > 0 ? 'method' : 'function',
        startLine,
        endLine,
        indent,
      });
      decoratorStart = null;
      continue;
    }

    decoratorStart = null;
  }

  const stack = [];
  const ordered = symbols.sort((a, b) => a.startLine - b.startLine);
  for (const symbol of ordered) {
    while (
      stack.length > 0 &&
      (stack[stack.length - 1].endLine < symbol.startLine ||
        stack[stack.length - 1].indent >= symbol.indent)
    ) {
      stack.pop();
    }
    symbol.depth = stack.length;
    const parent = stack[stack.length - 1];
    if (symbol.kind === 'method' && parent?.kind !== 'class') {
      symbol.kind = 'function';
    }
    stack.push(symbol);
  }

  return {
    language,
    symbols: ordered,
    imports,
    foldRanges: foldRangesFor(ordered),
  };
}

function assignDepth(symbols) {
  const stack = [];
  const ordered = [...symbols].sort(
    (a, b) => a.startLine - b.startLine || b.endLine - a.endLine
  );
  for (const symbol of ordered) {
    while (
      stack.length > 0 &&
      stack[stack.length - 1].endLine < symbol.startLine
    ) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    symbol.depth =
      parent && symbol.startLine > parent.startLine ? stack.length : 0;
    if (symbol.endLine > symbol.startLine) stack.push(symbol);
  }
}

function foldRangesFor(symbols) {
  const ranges = new Map();
  for (const symbol of symbols) {
    if (symbol.endLine <= symbol.startLine) continue;
    const previous = ranges.get(symbol.startLine) || 0;
    ranges.set(symbol.startLine, Math.max(previous, symbol.endLine));
  }
  return [...ranges.entries()]
    .map(([startLine, endLine]) => ({ startLine, endLine }))
    .sort((a, b) => a.startLine - b.startLine);
}

function analyzeCode(text, language) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const resolved = language || detectLanguage('', source);
  if (resolved === 'python') return parsePython(source, resolved);
  if (isJsLike(resolved)) return parseJs(source, resolved);
  return { language: resolved, symbols: [], imports: [], foldRanges: [] };
}

const api = {
  LANG_BY_EXT,
  languageFor,
  detectLanguage,
  analyzeCode,
  indentWidth,
};

if (typeof module === 'object' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.YAHCodeParse = api;
}

})();
