'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tools = require('../src/tools');

const SAMPLE = `
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fslint.dev%2F&amp;rut=x">Slint &amp; Rust</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fslint.dev%2F">A <b>declarative</b> GUI toolkit.</a>
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fslint-ui%2Fslint&amp;rut=y">GitHub - slint-ui/slint</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fslint-ui%2Fslint">Open-source GUI toolkit.</a>
`;

test('result blocks are parsed', () => {
  const results = tools._test.parseResults(SAMPLE, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Slint & Rust');
  assert.equal(results[0].url, 'https://slint.dev/');
  assert.equal(results[0].snippet, 'A declarative GUI toolkit.');
  assert.equal(results[1].url, 'https://github.com/slint-ui/slint');
});

test('html entities are decoded', () => {
  assert.equal(tools._test.decodeEntities('a &amp; b &#39;c&#39;'), "a & b 'c'");
  assert.equal(tools._test.decodeEntities('a&mdash;b'), 'a—b');
});

test('ddg redirect urls are unwrapped', () => {
  const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fslint.dev%2F&amp;rut=x';
  assert.equal(tools._test.decodeDdgUrl(href), 'https://slint.dev/');
});

test('definitions expose web_search and read_file', () => {
  const defs = tools.definitions();
  assert.equal(defs[0].type, 'function');
  assert.equal(defs[0].function.name, 'web_search');
  assert.equal(defs[1].function.name, 'read_file');
});

test('read_file returns numbered lines and supports paging', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-read-'));
  const file = path.join(dir, 'sample.txt');
  fs.writeFileSync(file, 'alpha\nbeta\ngamma\n');
  try {
    const full = await tools.execute(
      'read_file',
      JSON.stringify({ path: file })
    );
    assert.match(full, /1: alpha/);
    assert.match(full, /2: beta/);
    assert.match(full, /3: gamma/);

    const page = await tools.execute(
      'read_file',
      JSON.stringify({ path: file, offset: 2, limit: 1 })
    );
    assert.match(page, /2: beta/);
    assert.doesNotMatch(page, /1: alpha/);
    assert.match(page, /offset=3/);

    const empty = path.join(dir, 'empty.txt');
    fs.writeFileSync(empty, '');
    assert.match(
      await tools.execute('read_file', JSON.stringify({ path: empty })),
      /empty file/
    );

    const binary = path.join(dir, 'binary.dat');
    fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]));
    assert.match(
      await tools.execute('read_file', JSON.stringify({ path: binary })),
      /binary file/
    );

    assert.match(
      await tools.execute(
        'read_file',
        JSON.stringify({ path: path.join(dir, 'missing.txt') })
      ),
      /tool error/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('status label is short and readable', () => {
  assert.equal(
    tools.statusLabel('web_search', '{"query":"rust slint"}'),
    'web_search: rust slint'
  );
});

test('unknown tools fail as strings', async () => {
  const out = await tools.execute('nope', '{}');
  assert.match(out, /unknown tool/);
});

test(
  'live search returns results',
  { skip: process.env.LIVE_SEARCH !== '1' },
  async () => {
    const out = await tools.execute(
      'web_search',
      '{"query":"rust slint","max_results":3}'
    );
    assert.doesNotMatch(out, /tool error/);
    assert.match(out, /http/);
  }
);
