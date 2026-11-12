'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('definitions expose web_search', () => {
  const defs = tools.definitions();
  assert.equal(defs[0].type, 'function');
  assert.equal(defs[0].function.name, 'web_search');
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
