'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergedDefinitions } = require('../src/tools/definitions');
const { codeViewTool, pdfViewTool } = require('../src/tools/viewer');

const context = { enforceProjectRoots: false };

test('code and pdf viewer tools are defined', () => {
  const names = new Set(
    mergedDefinitions().map((item) => item.function?.name)
  );
  assert.ok(names.has('code_view'));
  assert.ok(names.has('pdf_view'));
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
