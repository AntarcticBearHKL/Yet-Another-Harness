'use strict';

// Hashline helpers ported from oh-my-opencode's hashline-core so OMO's
// LINE#ID edit workflow can run inside YAH.

const NIBBLE_STR = 'ZPMQVRWSNKTXJBYH';
const HASHLINE_DICT = Array.from({ length: 256 }, (_, index) => {
  const high = index >>> 4;
  const low = index & 0x0f;
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`;
});
const HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/;
const LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2})/;
const RE_SIGNIFICANT = /[\p{L}\p{N}]/u;

const PRIME32_1 = 0x9e3779b1;
const PRIME32_2 = 0x85ebca77;
const PRIME32_3 = 0xc2b2ae3d;
const PRIME32_4 = 0x27d4eb2f;
const PRIME32_5 = 0x165667b1;

function rotateLeft32(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function readUint32LittleEndian(input, offset) {
  return (
    ((input[offset] ?? 0) |
      ((input[offset + 1] ?? 0) << 8) |
      ((input[offset + 2] ?? 0) << 16) |
      ((input[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function round32(accumulator, value) {
  const added = (accumulator + Math.imul(value, PRIME32_2)) >>> 0;
  return Math.imul(rotateLeft32(added, 13), PRIME32_1) >>> 0;
}

function xxHash32(input, seed) {
  let offset = 0;
  const length = input.length;
  let hash;

  if (length >= 16) {
    const limit = length - 16;
    let value1 = (seed + PRIME32_1 + PRIME32_2) >>> 0;
    let value2 = (seed + PRIME32_2) >>> 0;
    let value3 = seed >>> 0;
    let value4 = (seed - PRIME32_1) >>> 0;

    while (offset <= limit) {
      value1 = round32(value1, readUint32LittleEndian(input, offset));
      offset += 4;
      value2 = round32(value2, readUint32LittleEndian(input, offset));
      offset += 4;
      value3 = round32(value3, readUint32LittleEndian(input, offset));
      offset += 4;
      value4 = round32(value4, readUint32LittleEndian(input, offset));
      offset += 4;
    }

    hash = (rotateLeft32(value1, 1) + rotateLeft32(value2, 7)) >>> 0;
    hash = (hash + rotateLeft32(value3, 12)) >>> 0;
    hash = (hash + rotateLeft32(value4, 18)) >>> 0;
  } else {
    hash = (seed + PRIME32_5) >>> 0;
  }

  hash = (hash + length) >>> 0;

  while (offset + 4 <= length) {
    hash =
      (hash + Math.imul(readUint32LittleEndian(input, offset), PRIME32_3)) >>>
      0;
    hash = Math.imul(rotateLeft32(hash, 17), PRIME32_4) >>> 0;
    offset += 4;
  }

  while (offset < length) {
    hash = (hash + Math.imul(input[offset] ?? 0, PRIME32_5)) >>> 0;
    hash = Math.imul(rotateLeft32(hash, 11), PRIME32_1) >>> 0;
    offset += 1;
  }

  hash = (hash ^ (hash >>> 15)) >>> 0;
  hash = Math.imul(hash, PRIME32_2) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, PRIME32_3) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

const encoder = new TextEncoder();

function computeNormalizedLineHash(lineNumber, normalizedContent) {
  const seed = RE_SIGNIFICANT.test(normalizedContent) ? 0 : lineNumber;
  const hash = xxHash32(encoder.encode(normalizedContent), seed >>> 0);
  return HASHLINE_DICT[hash % 256];
}

function computeLineHash(lineNumber, content) {
  return computeNormalizedLineHash(
    lineNumber,
    String(content ?? '').replace(/\r/g, '').trimEnd()
  );
}

function computeLegacyLineHash(lineNumber, content) {
  return computeNormalizedLineHash(
    lineNumber,
    String(content ?? '').replace(/\r/g, '').replace(/\s+/g, '')
  );
}

function formatHashLine(lineNumber, content) {
  return `${lineNumber}#${computeLineHash(lineNumber, content)}|${content}`;
}

function formatHashLines(content) {
  if (!content) return '';
  return String(content)
    .split('\n')
    .map((line, index) => formatHashLine(index + 1, line))
    .join('\n');
}

function normalizeLineRef(ref) {
  const original = String(ref ?? '').trim();
  let trimmed = original.replace(/^(?:>>>|[+-])\s*/, '');
  trimmed = trimmed.replace(/\s*#\s*/, '#');
  trimmed = trimmed.replace(/\|.*$/, '').trim();
  if (HASHLINE_REF_PATTERN.test(trimmed)) return trimmed;
  const extracted = trimmed.match(LINE_REF_EXTRACT_PATTERN);
  return extracted ? extracted[1] : original;
}

function parseLineRef(ref) {
  const normalized = normalizeLineRef(ref);
  const match = normalized.match(HASHLINE_REF_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid line reference format: "${ref}". Expected format: "{line_number}#{hash_id}"`
    );
  }
  return {
    line: Number.parseInt(match[1], 10),
    hash: match[2],
  };
}

function isCompatibleLineHash(line, content, hash) {
  return (
    computeLineHash(line, content) === hash ||
    computeLegacyLineHash(line, content) === hash
  );
}

function validateLineRef(lines, ref) {
  const parsed = parseLineRef(ref);
  if (parsed.line < 1 || parsed.line > lines.length) {
    throw new Error(
      `Line number ${parsed.line} out of bounds. File has ${lines.length} lines.`
    );
  }
  if (!isCompatibleLineHash(parsed.line, lines[parsed.line - 1], parsed.hash)) {
    const low = Math.max(1, parsed.line - 2);
    const high = Math.min(lines.length, parsed.line + 2);
    const context = [];
    for (let line = low; line <= high; line += 1) {
      context.push(`${line === parsed.line ? '>>> ' : '    '}${formatHashLine(line, lines[line - 1])}`);
    }
    throw new Error(
      `${parsed.line} has changed since last read. Copy the current tags and retry:\n${context.join('\n')}`
    );
  }
  return parsed;
}

function toLines(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((line) => String(line));
  return String(value).split('\n');
}

function applyHashlineEdits(content, edits) {
  const normalized = String(content ?? '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const operations = [];

  for (const edit of Array.isArray(edits) ? edits : []) {
    if (!edit || typeof edit !== 'object') continue;
    const op = String(edit.op || 'replace');
    if (!['replace', 'append', 'prepend'].includes(op)) {
      throw new Error(`Unsupported edit operation: ${op}`);
    }
    const linesValue = toLines(edit.lines);
    if (op === 'replace') {
      if (!edit.pos) throw new Error('replace requires a pos anchor');
      const pos = validateLineRef(lines, edit.pos);
      const end = edit.end ? validateLineRef(lines, edit.end) : pos;
      if (end.line < pos.line) throw new Error('end anchor must not precede pos');
      operations.push({
        op,
        start: pos.line - 1,
        end: end.line,
        lines: linesValue,
      });
      continue;
    }
    if (op === 'append') {
      const anchor = edit.pos ? validateLineRef(lines, edit.pos) : null;
      const at = anchor ? anchor.line : lines.length;
      operations.push({ op, start: at, end: at, lines: linesValue });
      continue;
    }
    const anchor = edit.pos ? validateLineRef(lines, edit.pos) : null;
    const at = anchor ? anchor.line - 1 : 0;
    operations.push({ op, start: at, end: at, lines: linesValue });
  }

  operations.sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < operations.length; i += 1) {
    if (operations[i].end > operations[i - 1].start) {
      throw new Error('Overlapping edit ranges are not allowed');
    }
  }

  const output = [...lines];
  for (const operation of operations) {
    output.splice(
      operation.start,
      operation.end - operation.start,
      ...operation.lines
    );
  }
  return output.join('\n');
}

module.exports = {
  NIBBLE_STR,
  HASHLINE_REF_PATTERN,
  computeLineHash,
  computeLegacyLineHash,
  formatHashLine,
  formatHashLines,
  normalizeLineRef,
  parseLineRef,
  validateLineRef,
  applyHashlineEdits,
};
