'use strict';

// 上下文编辑器的纯逻辑：把 system + 消息摊成一块文本，再解析回来。
// 用 UMD 包一层，渲染进程走 window.MiniharnessContext，node --test 直接 require。

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MiniharnessContext = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function formatContext(session) {
    let out = `SYSTEM\n${String(session.system ?? '').replace(/\s+$/, '')}\n\n`;
    for (const msg of session.msgs || []) {
      const role = msg.role === 'User' ? 'USER' : 'ASSISTANT';
      out += `${role}\n${String(msg.text ?? '').replace(/\s+$/, '')}\n\n`;
    }
    return out;
  }

  function parseMarker(line) {
    let text = String(line).trim();
    if (text.startsWith('[') && text.endsWith(']')) {
      text = text.slice(1, -1);
    }
    text = text.replace(/:+$/, '').trim().toUpperCase();
    if (text === 'SYSTEM') return 'SYSTEM';
    if (text === 'USER') return 'USER';
    if (text === 'ASSISTANT' || text === 'AGENT') return 'AGENT';
    return null;
  }

  function parseContext(text) {
    const normalized = String(text).replace(/\r\n/g, '\n');
    const msgs = [];
    const preamble = [];
    let system;
    let block = null;
    let sawMarker = false;

    const flush = () => {
      if (!block) return;
      const content = block.lines.join('\n').trim();
      if (block.kind === 'SYSTEM') {
        system = content; // 允许空字符串：用户可能就是要清掉系统提示词
      } else if (content) {
        msgs.push({
          role: block.kind === 'USER' ? 'User' : 'Agent',
          text: content,
          request: null,
        });
      }
      block = null;
    };

    for (const line of normalized.split('\n')) {
      const kind = parseMarker(line);
      if (kind) {
        sawMarker = true;
        flush();
        block = { kind, lines: [] };
      } else if (block) {
        block.lines.push(line);
      } else {
        preamble.push(line);
      }
    }
    flush();

    if (!sawMarker) {
      throw new Error('Context needs SYSTEM / USER / ASSISTANT labels.');
    }
    if (system === undefined) {
      const text = preamble.join('\n').trim();
      if (text) system = text;
    }
    if (system === undefined && msgs.length === 0) {
      throw new Error('Context is empty. Keep at least the SYSTEM block.');
    }
    return { system, msgs };
  }

  return { formatContext, parseMarker, parseContext };
});
