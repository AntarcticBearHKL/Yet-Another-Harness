'use strict';

/*
 * Tool catalog grouping shared by the renderer and the Node test suite.
 * Function names stay English; only labels are localized.
 */

(function (root) {
  const TOOL_GROUPS = [
    {
      id: 'system',
      label: '系统',
      pattern: /shell|exec|command|process|terminal|system|bash/i,
    },
    {
      id: 'file',
      label: '文件',
      pattern: /file|read|write|edit|glob|grep|directory|path|patch/i,
    },
    {
      id: 'search',
      label: '网络',
      pattern: /search|web|browse|fetch|http|url/i,
    },
    {
      id: 'git',
      label: 'Git',
      pattern: /^(git_|worktree_)/i,
    },
    {
      id: 'view',
      label: '交互',
      pattern: /view|code|pdf|chrome|browser|devtools|playwright/i,
    },
    {
      id: 'background',
      label: '任务',
      pattern: /background|monitor/i,
    },
    {
      id: 'subagent',
      label: 'subagent',
      pattern: /^(subagent|delegate_task|call_omo_agent)/i,
    },
    {
      id: 'agile',
      label: 'Agile',
      pattern: /^agile_/i,
    },
    {
      id: 'canvas',
      label: '画布',
      pattern: /^worknode_|^team_layout$/i,
    },
    {
      id: 'agent',
      label: '代理',
      hidden: true,
      pattern: /agent|task|subagent|skill|mcp|team|goal|question|model|worktree|look_at/i,
    },
    {
      id: 'session',
      label: '会话',
      hidden: true,
      pattern: /session/i,
    },
  ];

  const TOOL_GROUP_BY_NAME = new Map([
    ['read', 'file'],
    ['write', 'file'],
    ['edit', 'file'],
    ['hashline_edit', 'file'],
    ['glob', 'file'],
    ['grep', 'file'],
    ['patch', 'git'],
    ['websearch', 'search'],
    ['webfetch', 'search'],
    ['shell', 'system'],
    ['systeminfo', 'system'],
    ['mouse', 'system'],
    ['code_view', 'view'],
    ['pdf_view', 'view'],
    ['html_view', 'view'],
    ['chrome', 'view'],
    ['background_start', 'background'],
    ['background_list', 'background'],
    ['background_stop', 'background'],
    ['background_output', 'background'],
    ['background_cancel', 'background'],
    ['monitor_start', 'background'],
    ['monitor_stop', 'background'],
    ['monitor_list', 'background'],
    ['monitor_output', 'background'],
    ['subagent_start', 'subagent'],
    ['subagent_list', 'subagent'],
    ['subagent_output', 'subagent'],
    ['subagent_stop', 'subagent'],
    ['skill', 'agent'],
    ['skill_mcp', 'agent'],
    ['task', 'subagent'],
    ['subagent', 'subagent'],
    ['call_omo_agent', 'subagent'],
    ['delegate_task', 'subagent'],
    ['task_create', 'agent'],
    ['task_get', 'agent'],
    ['task_list', 'agent'],
    ['task_update', 'agent'],
    ['team_list', 'agent'],
    ['team_task_list', 'agent'],
    ['look_at', 'agent'],
    ['question', 'agent'],
    ['models', 'agent'],
    ['list_mcp_resources', 'agent'],
    ['read_mcp_resource', 'agent'],
    ['session_list', 'session'],
    ['session_read', 'session'],
    ['session_search', 'session'],
    ['session_info', 'session'],
    ['session_rename', 'session'],
  ]);

  const GIT_TOOL_NAMES = [
    'git_status',
    'git_diff',
    'git_log',
    'git_show',
    'git_blame',
    'git_branch',
    'git_checkout',
    'git_add',
    'git_commit',
    'git_stash',
    'git_fetch',
    'git_pull',
    'git_push',
    'git_merge',
    'git_remote',
    'git_tag',
    'git_restore',
    'git_reset',
    'git_revert',
    'git_cherry_pick',
    'worktree_list',
    'worktree_create',
    'worktree_remove',
  ];
  for (const name of GIT_TOOL_NAMES) {
    TOOL_GROUP_BY_NAME.set(name, 'git');
  }

  function toolGroupFor(fn) {
    const name = String(fn?.name || '');
    const description = String(fn?.description || '');
    const explicit = TOOL_GROUP_BY_NAME.get(name);
    if (explicit) {
      return TOOL_GROUPS.find((group) => group.id === explicit);
    }
    return (
      TOOL_GROUPS.find((group) => group.pattern.test(name)) ||
      TOOL_GROUPS.find((group) => group.pattern.test(description)) || {
        id: 'other',
        label: '画布',
      }
    );
  }

  function toolCountsByGroup(tools) {
    const counts = new Map();
    if (!Array.isArray(tools)) return counts;
    for (const entry of tools) {
      const fn = entry.function || entry;
      const group = toolGroupFor(fn);
      counts.set(group.id, (counts.get(group.id) || 0) + 1);
    }
    return counts;
  }

  const api = {
    TOOL_GROUPS,
    TOOL_GROUP_BY_NAME,
    GIT_TOOL_NAMES,
    toolGroupFor,
    toolCountsByGroup,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    Object.assign(root, api);
  }
})(typeof window !== 'undefined' ? window : null);
