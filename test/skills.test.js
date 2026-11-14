'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSkillService, parseFrontmatter } = require('../server/skills');

function withSkillDirs(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-skills-root-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-skills-data-'));
  return Promise.resolve()
    .then(() => fn(root, data))
    .finally(() => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(data, { recursive: true, force: true });
    });
}

test('skill frontmatter is parsed', () => {
  const parsed = parseFrontmatter(
    '---\nname: Demo\ndescription: A demo\nkeywords: one, two, 三\n---\n\nDo the thing.\n'
  );
  assert.equal(parsed.meta.name, 'Demo');
  assert.equal(parsed.meta.description, 'A demo');
  assert.deepEqual(parsed.meta.keywords, ['one', 'two', '三']);
  assert.equal(parsed.body, 'Do the thing.');
});

test('file skills are listed and resolved', () => {
  return withSkillDirs((root, data) => {
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(data, 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'skills', 'demo.md'),
      '---\nname: Demo Skill\ndescription: Built in\nkeywords: demo, test\n---\n\nUse the demo skill.\n'
    );
    fs.writeFileSync(
      path.join(data, 'skills', 'mine.md'),
      '---\nname: My Skill\ndescription: User skill\n---\n\nUse my skill.\n'
    );
    const service = createSkillService({
      root,
      dataDir: data,
      mcpManager: { promptList: () => [] },
    });
    const skills = service.list({});
    const files = skills.filter((skill) => skill.sourceKind !== 'system');
    assert.equal(files.length, 2);
    assert.equal(skills.find((skill) => skill.name === 'Demo Skill').source, '内置');
    assert.equal(skills.find((skill) => skill.name === 'My Skill').source, '用户');
    return service
      .resolveMany([{ id: 'builtin:demo' }, { id: 'user:mine' }])
      .then((result) => {
        assert.match(result.text, /## Skill: Demo Skill/);
        assert.match(result.text, /Use the demo skill\./);
        assert.match(result.text, /## Skill: My Skill/);
        assert.deepEqual(result.names, ['Demo Skill', 'My Skill']);
      });
  });
});

test('file skills get a category', () => {
  return withSkillDirs((root, data) => {
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(data, 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'skills', 'demo.md'),
      '---\nname: Demo Skill\ndescription: Built in\n---\n\nUse the demo skill.\n'
    );
    fs.writeFileSync(
      path.join(data, 'skills', 'mine.md'),
      '---\nname: My Skill\ndescription: User skill\n---\n\nUse my skill.\n'
    );
    fs.writeFileSync(
      path.join(data, 'skills', 'draw.md'),
      '---\nname: Draw Skill\ndescription: Drawing\ncategory: 绘画\n---\n\nDraw.\n'
    );
    const service = createSkillService({
      root,
      dataDir: data,
      mcpManager: { promptList: () => [] },
    });
    const skills = service.list({});
    assert.equal(
      skills.find((skill) => skill.name === 'Demo Skill').category,
      '内置'
    );
    assert.equal(
      skills.find((skill) => skill.name === 'My Skill').category,
      '用户'
    );
    assert.equal(
      skills.find((skill) => skill.name === 'Draw Skill').category,
      '绘画'
    );
  });
});

test('system skills are built in, read-only commands', async () => {
  await withSkillDirs(async (root, data) => {
    const service = createSkillService({
      root,
      dataDir: data,
      mcpManager: { promptList: () => [] },
    });
    const system = service
      .list({})
      .filter((skill) => skill.sourceKind === 'system');
    assert.deepEqual(
      system.map((skill) => skill.id),
      ['system:compact', 'system:goal']
    );
    assert.ok(system.every((skill) => skill.readOnly === true));
    assert.ok(system.every((skill) => skill.command));
    const resolved = await service.resolveMany([{ id: 'system:compact' }]);
    assert.match(resolved.text, /System Skill · compact/);
  });
});

test('MCP prompts become per-session skills and resolve', async () => {
  await withSkillDirs(async (root, data) => {
    const calls = [];
    const mcpManager = {
      promptList: () => [
        {
          serverId: 's1',
          serverName: 'Demo Server',
          prompt: {
            name: 'summarize',
            title: 'Summarize',
            description: 'Summarize a topic.',
            arguments: [
              { name: 'topic', description: 'Topic', required: true },
            ],
          },
        },
      ],
      getPrompt: async (serverId, name, args) => {
        calls.push({ serverId, name, args });
        return { ok: true, text: `summary for ${args.topic}` };
      },
    };
    const service = createSkillService({ root, dataDir: data, mcpManager });
    const skills = service.list({});
    const mcpSkills = skills.filter((skill) => skill.sourceKind === 'mcp');
    assert.equal(mcpSkills.length, 1);
    assert.equal(mcpSkills[0].id, 'mcp:s1:summarize');
    assert.equal(mcpSkills[0].source, 'MCP');
    assert.equal(mcpSkills[0].arguments[0].required, true);
    assert.equal(
      service.list({ mcpDisabled: ['s1'] }).some((skill) => skill.sourceKind === 'mcp'),
      false
    );

    const result = await service.resolveMany(
      [{ id: 'mcp:s1:summarize', arguments: { topic: 'skills' } }],
      []
    );
    assert.match(result.text, /summary for skills/);
    assert.deepEqual(calls, [
      { serverId: 's1', name: 'summarize', args: { topic: 'skills' } },
    ]);

    await assert.rejects(
      service.resolveMany([{ id: 'mcp:s1:summarize' }], []),
      /缺少 Skill 参数/
    );
    await assert.rejects(
      service.resolveMany([{ id: 'mcp:s1:summarize', arguments: { topic: 'x' } }], ['s1']),
      /已在当前对话中关闭/
    );
  });
});
