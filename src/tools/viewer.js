'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guardPath } = require('./guard');

const MAX_CODE_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 80 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function integer(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

async function resolveFile(args, context, tool) {
  const raw = String(args?.path || '').trim();
  if (!raw) throw new Error('path is required');
  const abs = path.resolve(raw);
  await guardPath(abs, context, { tool });
  const stat = await fs.promises.stat(abs).catch(() => null);
  if (!stat) throw new Error(`path does not exist: ${abs}`);
  if (!stat.isFile()) throw new Error(`not a file: ${abs}`);
  return { abs, stat };
}

function titleFor(args, abs) {
  const title = String(args?.title || '').trim();
  return (title || path.basename(abs) || 'Viewer').slice(0, 120);
}

async function codeViewTool(args = {}, context = null) {
  const { abs, stat } = await resolveFile(args, context, 'code_view');
  if (stat.size > MAX_CODE_BYTES) {
    throw new Error('code file is larger than 4 MB');
  }
  const buffer = await fs.promises.readFile(abs);
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new Error('code file looks binary');
  }
  const lineCount = Math.max(1, buffer.toString('utf8').split(/\r?\n/).length);
  const line = integer(args.line, null);
  const endLine = integer(args.end_line, null);
  let start =
    line === null
      ? endLine === null
        ? null
        : 1
      : Math.max(1, Math.min(lineCount, line));
  let end =
    endLine === null
      ? start
      : Math.max(1, Math.min(lineCount, endLine));
  if (start !== null && end < start) end = start;
  return JSON.stringify({
    ok: true,
    kind: 'code',
    key: `code:${abs}`,
    path: abs,
    title: titleFor(args, abs),
    line: start,
    end_line: end,
    sessionId: context?.sessionId || null,
  });
}

async function pdfViewTool(args = {}, context = null) {
  const { abs, stat } = await resolveFile(args, context, 'pdf_view');
  if (stat.size > MAX_PDF_BYTES) {
    throw new Error('PDF is larger than 80 MB');
  }
  const handle = await fs.promises.open(abs, 'r');
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    if (header.toString('latin1') !== '%PDF-') {
      throw new Error('file is not a PDF');
    }
  } finally {
    await handle.close();
  }
  const page = Math.max(1, integer(args.page, 1));
  const query = String(args.query || '').trim().slice(0, 200);
  return JSON.stringify({
    ok: true,
    kind: 'pdf',
    key: `pdf:${abs}`,
    path: abs,
    title: titleFor(args, abs),
    page,
    query,
    sessionId: context?.sessionId || null,
  });
}

async function htmlViewTool(args = {}) {
  const html = String(args.html ?? '');
  if (!html.trim()) throw new Error('html is required');
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('HTML is larger than 2 MB');
  }
  const title = String(args.title || 'HTML').trim().slice(0, 120) || 'HTML';
  const dir = path.join(os.tmpdir(), 'yah-html');
  await fs.promises.mkdir(dir, { recursive: true });
  const id = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const file = path.join(dir, `${id}.html`);
  await fs.promises.writeFile(file, html, 'utf8');
  return JSON.stringify({
    ok: true,
    kind: 'html',
    key: `html:${title}`,
    path: file,
    title,
  });
}

module.exports = { codeViewTool, pdfViewTool, htmlViewTool };
