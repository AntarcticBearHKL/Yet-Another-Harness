'use strict';

// File-based skills + dynamic MCP prompt skills. File skills live in the repo
// `skills/` folder (built-in) and `%APPDATA%\yah\skills` (user). MCP skills are
// derived from the prompts exposed by currently connected, enabled servers.

const fs = require('node:fs');
const path = require('node:path');

const MAX_SKILLS = 100;
const MAX_SKILL_TEXT = 24_000;
const MAX_ATTACHED_SKILLS = 5;

// Built-in system skills carry fixed instructions and cannot be edited. They
// are commands rather than plain text skills: `/compact` and `/goal` execute
// the matching backend action instead of being attached to a prompt.
const SYSTEM_SKILLS = [
  {
    id: 'system:compact',
    name: 'compact',
    description:
      '压缩当前对话上下文：保留结构化摘要和最近消息，然后继续工作。',
    keywords: ['compact', '压缩', '上下文', 'summary', 'checkpoint'],
    category: '系统',
    source: '系统',
    sourceKind: 'system',
    readOnly: true,
    command: 'compact',
    body:
      '# System Skill · compact\n' +
      'Compress the conversation into the structured checkpoint template, ' +
      'keep the newest exchanges verbatim, and continue from that checkpoint. ' +
      'This instruction is built in and cannot be edited.',
  },
  {
    id: 'system:goal',
    name: 'goal',
    description:
      '把一条消息设为会话目标，自动推进，并在每轮结束后验证目标是否完成。',
    keywords: ['goal', '目标', '自动推进', '验证', 'audit'],
    category: '系统',
    source: '系统',
    sourceKind: 'system',
    readOnly: true,
    command: 'goal',
    body:
      '# System Skill · goal\n' +
      'Keep working toward the persisted objective across turns. After every ' +
      'turn, report what is done, what was verified, and what remains. A ' +
      'separate goal check decides whether to continue, complete, or block. ' +
      'This instruction is built in and cannot be edited.',
  },
];

function parseKeywords(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFrontmatter(text) {
  const source = String(text ?? '');
  const match = source.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
  );
  if (!match) return { meta: {}, body: source.trim() };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (!key) continue;
    if (key === 'keywords' || key === 'tags') {
      meta.keywords = parseKeywords(value);
    } else {
      meta[key] = value;
    }
  }
  return { meta, body: match[2].trim() };
}

function readSkillFile(filePath, source) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(text);
  if (!body) return null;
  const base = path.basename(filePath, path.extname(filePath));
  const category = String(
    meta.category || (source === 'user' ? '用户' : '内置')
  ).trim();
  return {
    id: `${source}:${base}`,
    name: String(meta.name || base),
    description: String(meta.description || ''),
    keywords: parseKeywords(meta.keywords),
    category,
    source: source === 'user' ? '用户' : '内置',
    sourceKind: source,
    body,
  };
}

function listDir(dir, source) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(md|markdown)$/i.test(entry.name)) continue;
    const skill = readSkillFile(path.join(dir, entry.name), source);
    if (skill) skills.push(skill);
  }
  return skills;
}

function createSkillService({ root, dataDir, mcpManager }) {
  const dirs = [
    { dir: path.join(root, 'skills'), source: 'builtin' },
    { dir: path.join(dataDir, 'skills'), source: 'user' },
  ];

  function fileSkills() {
    return dirs
      .flatMap(({ dir, source }) => listDir(dir, source))
      .slice(0, MAX_SKILLS);
  }

  function mcpSkills(mcpDisabled = []) {
    const disabled = new Set(
      Array.isArray(mcpDisabled) ? mcpDisabled.map(String) : []
    );
    const prompts =
      typeof mcpManager?.promptList === 'function'
        ? mcpManager.promptList()
        : [];
    return prompts
      .filter((entry) => !disabled.has(entry.serverId))
      .map(({ serverId, serverName, prompt }) => {
        const promptName = String(prompt?.name || '');
        if (!promptName) return null;
        const args = Array.isArray(prompt.arguments)
          ? prompt.arguments
              .map((argument) => ({
                name: String(argument.name || ''),
                description: String(argument.description || ''),
                required: Boolean(argument.required),
              }))
              .filter((argument) => argument.name)
          : [];
        return {
          id: `mcp:${serverId}:${promptName}`,
          name: String(prompt.title || prompt.name || promptName),
          description: String(prompt.description || ''),
          keywords: [
            promptName,
            prompt.title,
            prompt.description,
            serverName,
          ]
            .filter(Boolean)
            .map(String),
          source: 'MCP',
          sourceKind: 'mcp',
          serverId,
          serverName,
          promptName,
          arguments: args,
        };
      })
      .filter(Boolean);
  }

  function list({ mcpDisabled = [] } = {}) {
    return [
      ...SYSTEM_SKILLS.map(({ body, ...meta }) => ({
        ...meta,
        system: true,
        readOnly: true,
        instruction: body.slice(0, 1_200),
      })),
      ...fileSkills().map(({ body, ...meta }) => meta),
      ...mcpSkills(mcpDisabled),
    ];
  }

  async function resolveOne(skill, mcpDisabled) {
    const id = String(skill?.id || '').trim();
    if (!id) throw new Error('skill id is required');

    if (id.startsWith('system:')) {
      const entry = SYSTEM_SKILLS.find((item) => item.id === id);
      if (!entry) throw new Error('系统 Skill 不存在');
      return { id, name: entry.name, text: entry.body };
    }

    if (id.startsWith('mcp:')) {
      const entry = mcpSkills([]).find((item) => item.id === id);
      if (!entry) throw new Error('MCP Skill 不存在或服务器未连接');
      const disabled = new Set(
        Array.isArray(mcpDisabled) ? mcpDisabled.map(String) : []
      );
      if (disabled.has(entry.serverId)) {
        throw new Error('该 MCP 服务器已在当前对话中关闭');
      }
      const inputArgs =
        skill?.arguments && typeof skill.arguments === 'object'
          ? skill.arguments
          : {};
      const args = {};
      for (const argument of entry.arguments) {
        const value = String(inputArgs[argument.name] ?? '').trim();
        if (argument.required && !value) {
          throw new Error(`缺少 Skill 参数：${argument.name}`);
        }
        if (value) args[argument.name] = value;
      }
      const response = await mcpManager.getPrompt(
        entry.serverId,
        entry.promptName,
        args
      );
      if (!response?.ok) {
        throw new Error(response?.error || 'MCP Skill 获取失败');
      }
      return {
        id,
        name: entry.name,
        text: String(response.text || ''),
      };
    }

    const file = fileSkills().find((item) => item.id === id);
    if (!file) throw new Error('Skill 不存在');
    return { id, name: file.name, text: file.body };
  }

  async function resolveMany(skills, mcpDisabled = []) {
    const parts = [];
    const names = [];
    let used = 0;
    const incoming = Array.isArray(skills)
      ? skills.slice(0, MAX_ATTACHED_SKILLS)
      : [];
    for (const skill of incoming) {
      const resolved = await resolveOne(skill, mcpDisabled);
      if (!resolved.text) continue;
      const block = `## Skill: ${resolved.name}\n${resolved.text}`;
      if (used + block.length > MAX_SKILL_TEXT) break;
      parts.push(block);
      names.push(resolved.name);
      used += block.length + 2;
    }
    return { text: parts.join('\n\n'), names };
  }

  return { list, resolveMany };
}

module.exports = { createSkillService, parseFrontmatter, SYSTEM_SKILLS };
