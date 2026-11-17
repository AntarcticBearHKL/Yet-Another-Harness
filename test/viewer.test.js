'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergedDefinitions } = require('../src/tools/definitions');
const { codeViewTool, pdfViewTool, htmlViewTool } = require('../src/tools/viewer');

const context = { enforceProjectRoots: false };

test('viewer tools are defined', () => {
  const names = new Set(
    mergedDefinitions().map((item) => item.function?.name)
  );
  assert.ok(names.has('code_view'));
  assert.ok(names.has('pdf_view'));
  assert.ok(names.has('html_view'));
});

test('html viewer allows scripts and interactive content', () => {
  const definition = mergedDefinitions().find(
    (item) => item.function?.name === 'html_view'
  );
  assert.match(definition.function.description, /JavaScript run/);
  assert.doesNotMatch(definition.function.description, /scripts are disabled/);

  const renderer = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'content.js'),
    'utf8'
  );
  assert.match(renderer, /allow-scripts/);
  assert.ok(!renderer.includes('replace(/<script'));

  const shell = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'content.html'),
    'utf8'
  );
  assert.match(shell, /script-src[^;]*'unsafe-inline'/);
});

test('viewer tools return window payloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-viewer-'));
  try {
    const codeFile = path.join(dir, 'sample.js');
    fs.writeFileSync(codeFile, 'const a = 1;\nconst b = 2;\n', 'utf8');
    const code = JSON.parse(
      await codeViewTool(
        { path: codeFile, line: 2, end_line: 2 },
        context
      )
    );
    assert.equal(code.ok, true);
    assert.equal(code.kind, 'code');
    assert.equal(code.line, 2);
    assert.equal(code.end_line, 2);

    const pdfFile = path.join(dir, 'sample.pdf');
    fs.writeFileSync(pdfFile, '%PDF-1.4\n%%EOF\n');
    const pdf = JSON.parse(
      await pdfViewTool(
        { path: pdfFile, page: 3, query: 'hello' },
        context
      )
    );
    assert.equal(pdf.ok, true);
    assert.equal(pdf.kind, 'pdf');
    assert.equal(pdf.page, 3);
    assert.equal(pdf.query, 'hello');

    await assert.rejects(
      () => pdfViewTool({ path: codeFile }, context),
      /not a PDF/
    );

    const html = JSON.parse(
      await htmlViewTool(
        {
          title: 'demo',
          html: '<h1>Hello</h1><p>presentation</p>',
        },
        context
      )
    );
    assert.equal(html.ok, true);
    assert.equal(html.kind, 'html');
    assert.equal(html.title, 'demo');
    assert.match(fs.readFileSync(html.path, 'utf8'), /Hello/);
    fs.rmSync(html.path, { force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
