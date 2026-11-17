'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergedDefinitions } = require('../src/tools/definitions');
const {
  TOOL_I18N,
  toolDisplayName,
  toolDisplayDescription,
  toolParamDescription,
} = require('../src/tool-i18n');

test('every built-in tool has Chinese display text', () => {
  for (const definition of mergedDefinitions()) {
    const fn = definition.function || definition;
    const name = String(fn.name || '');
    assert.ok(TOOL_I18N[name], `missing Chinese tool entry: ${name}`);
    assert.ok(
      toolDisplayDescription(name),
      `missing Chinese description: ${name}`
    );
    for (const param of Object.keys(fn.parameters?.properties || {})) {
      assert.ok(
        toolParamDescription(name, param),
        `missing Chinese parameter text: ${name}.${param}`
      );
    }
  }
});

test('tool display helpers translate names, types and parameters', () => {
  assert.equal(toolDisplayName('read'), 'read');
  assert.equal(toolDisplayName('agile_create_task'), 'agile_create_task');
  assert.equal(toolDisplayName('unknown_tool'), 'unknown_tool');
  assert.match(toolDisplayDescription('read'), /文本文件|目录/);
  assert.equal(toolParamDescription('read', 'path'), '路径');
  assert.equal(toolParamDescription('webfetch', 'format'), '返回格式：markdown（默认）、text 或 html');
});
