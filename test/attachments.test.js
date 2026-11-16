'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const attachments = require('../src/attachments');

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('attachments save, read and resolve image data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-attachments-'));
  try {
    attachments.init(dir);
    const saved = attachments.saveDataUrl(ONE_PIXEL_PNG, {
      name: 'dot.png',
      width: 1,
      height: 1,
    });
    assert.match(saved.id, /^[a-f0-9-]+\.png$/);
    assert.equal(saved.url, `/api/attachments/${saved.id}`);
    assert.equal(saved.mime, 'image/png');
    assert.equal(saved.name, 'dot.png');
    assert.equal(saved.width, 1);
    assert.equal(saved.height, 1);
    assert.ok(saved.size > 0);

    const read = attachments.read(saved.id);
    assert.equal(read.mime, 'image/png');
    assert.equal(read.data.length, saved.size);

    const dataUrl = attachments.toDataUrl(saved);
    assert.ok(dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(
      attachments.normalizeImages([
        saved,
        { mime: 'text/plain', url: '/api/attachments/nope.txt' },
        { mime: 'image/png', url: 'https://example.com/a.png' },
      ]).length,
      1
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachments reject non-image payloads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-attachments-'));
  try {
    attachments.init(dir);
    assert.throws(
      () => attachments.saveDataUrl('data:text/plain;base64,aGVsbG8=', {}),
      /invalid image data/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
