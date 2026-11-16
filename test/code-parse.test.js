'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../src/code-parse');

test('python outline finds classes, methods, decorators and imports', () => {
  const code = [
    'import os',
    'from typing import List',
    '',
    'class Service:',
    '    def __init__(self, name):',
    '        self.name = name',
    '',
    '    @staticmethod',
    '    def build(value):',
    '        if value:',
    '            return value',
    '        return None',
    '',
    'async def main():',
    '    service = Service("x")',
    '    return service',
  ].join('\n');
  const result = parser.analyzeCode(code, 'python');
  const byName = new Map(result.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.get('Service').kind, 'class');
  assert.equal(byName.get('Service').startLine, 4);
  assert.equal(byName.get('Service').endLine, 12);
  assert.equal(byName.get('__init__').kind, 'method');
  assert.equal(byName.get('__init__').startLine, 5);
  assert.equal(byName.get('__init__').endLine, 6);
  assert.equal(byName.get('build').kind, 'method');
  assert.equal(byName.get('build').startLine, 8);
  assert.equal(byName.get('build').endLine, 12);
  assert.equal(byName.get('build').depth, 1);
  assert.equal(byName.get('main').kind, 'function');
  assert.equal(byName.get('main').startLine, 14);
  assert.equal(byName.get('main').endLine, 16);
  assert.deepEqual(
    result.imports.map((item) => item.name),
    ['os', 'typing → List']
  );
  assert.ok(
    result.foldRanges.some(
      (range) => range.startLine === 4 && range.endLine === 12
    )
  );
});

test('javascript outline finds classes, methods, fields and arrows', () => {
  const code = [
    "import React from 'react';",
    '',
    'export class Widget {',
    '  constructor(name) {',
    '    this.name = name;',
    '  }',
    '',
    '  render(value) {',
    '    if (value) {',
    '      return value;',
    '    }',
    '    return null;',
    '  }',
    '',
    '  handle = () => {',
    '    return this.name;',
    '  };',
    '}',
    '',
    'export function makeWidget(name) {',
    '  return new Widget(name);',
    '}',
    '',
    'const load = async (id) => {',
    '  return id;',
    '};',
  ].join('\n');
  const result = parser.analyzeCode(code, 'javascript');
  const byName = new Map(result.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.get('Widget').kind, 'class');
  assert.equal(byName.get('Widget').startLine, 3);
  assert.equal(byName.get('Widget').endLine, 18);
  assert.equal(byName.get('constructor').kind, 'method');
  assert.equal(byName.get('constructor').startLine, 4);
  assert.equal(byName.get('constructor').endLine, 6);
  assert.equal(byName.get('render').kind, 'method');
  assert.equal(byName.get('render').startLine, 8);
  assert.equal(byName.get('render').endLine, 13);
  assert.equal(byName.get('handle').kind, 'method');
  assert.equal(byName.get('handle').startLine, 15);
  assert.equal(byName.get('handle').endLine, 17);
  assert.equal(byName.get('makeWidget').kind, 'function');
  assert.equal(byName.get('makeWidget').startLine, 20);
  assert.equal(byName.get('makeWidget').endLine, 22);
  assert.equal(byName.get('load').kind, 'function');
  assert.equal(byName.get('load').startLine, 24);
  assert.equal(byName.get('load').endLine, 26);
  assert.equal(byName.get('constructor').depth, 1);
  assert.equal(byName.get('if'), undefined);
  assert.deepEqual(result.imports.map((item) => item.name), ['react']);
});

test('typescript outline finds interfaces, types and typed methods', () => {
  const code = [
    'interface User {',
    '  id: number;',
    '  name: string;',
    '}',
    '',
    'type Result = {',
    '  ok: boolean;',
    '  user: User;',
    '};',
    '',
    'export class UserService {',
    '  async load(id: string): Promise<User> {',
    '    const user = await fetchUser(id);',
    '    return user;',
    '  }',
    '}',
    '',
    'function fetchUser(id: string): Promise<User> {',
    "  return Promise.resolve({ id, name: '' });",
    '}',
  ].join('\n');
  const result = parser.analyzeCode(code, 'typescript');
  const byName = new Map(result.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.get('User').kind, 'type');
  assert.equal(byName.get('User').startLine, 1);
  assert.equal(byName.get('User').endLine, 4);
  assert.equal(byName.get('Result').kind, 'type');
  assert.equal(byName.get('Result').startLine, 6);
  assert.equal(byName.get('Result').endLine, 9);
  assert.equal(byName.get('UserService').kind, 'class');
  assert.equal(byName.get('UserService').startLine, 11);
  assert.equal(byName.get('UserService').endLine, 16);
  assert.equal(byName.get('load').kind, 'method');
  assert.equal(byName.get('load').startLine, 12);
  assert.equal(byName.get('load').endLine, 15);
  assert.equal(byName.get('fetchUser').kind, 'function');
  assert.equal(byName.get('fetchUser').startLine, 18);
  assert.equal(byName.get('fetchUser').endLine, 20);
});

test('language detection covers python, javascript and typescript', () => {
  assert.equal(parser.languageFor('a.py'), 'python');
  assert.equal(parser.languageFor('a.ts'), 'typescript');
  assert.equal(parser.languageFor('a.js'), 'javascript');
  assert.equal(parser.detectLanguage('', 'def main():\n    pass'), 'python');
  assert.equal(
    parser.detectLanguage('', 'interface X { value: string }'),
    'typescript'
  );
  assert.equal(parser.detectLanguage('', 'const x = 1;'), 'javascript');
});
