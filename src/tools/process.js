'use strict';

const { spawn } = require('node:child_process');

const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT = 120_000;
let sequence = 0;
const jobs = new Map();

function shellCommand(command) {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    };
  }
  return {
    file: process.env.SHELL || '/bin/sh',
    args: ['-lc', command],
  };
}

function appendOutput(job, chunk, channel) {
  const text = chunk.toString();
  if (channel === 'stderr') job.stderr += text;
  else job.output += text;
  if (job.output.length + job.stderr.length > MAX_OUTPUT) {
    job.truncated = true;
    job.output = job.output.slice(0, MAX_OUTPUT);
    job.stderr = job.stderr.slice(0, MAX_OUTPUT);
  }
}

function startJob(command, options = {}) {
  const id = `bg-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;
  const cwd = options.cwd || process.cwd();
  const shell = shellCommand(command);
  const child = spawn(shell.file, shell.args, {
    cwd,
    windowsHide: true,
    env: process.env,
  });
  const job = {
    id,
    command,
    cwd,
    status: 'running',
    output: '',
    stderr: '',
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    truncated: false,
    child,
    timer: null,
  };
  child.stdout.on('data', (chunk) => appendOutput(job, chunk, 'stdout'));
  child.stderr.on('data', (chunk) => appendOutput(job, chunk, 'stderr'));
  child.on('error', (error) => {
    job.status = 'error';
    job.stderr += `\n${error.message}`;
    job.endedAt = Date.now();
  });
  child.on('close', (code) => {
    job.status = code === 0 ? 'done' : 'error';
    job.exitCode = code;
    job.endedAt = Date.now();
    if (job.timer) clearTimeout(job.timer);
  });
  if (options.timeout !== 0) {
    const timeout = Math.max(
      1000,
      Math.min(30 * 60_000, Number(options.timeout) || DEFAULT_TIMEOUT)
    );
    job.timer = setTimeout(() => {
      if (job.status !== 'running') return;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      job.status = 'timeout';
      job.endedAt = Date.now();
    }, timeout);
  }
  jobs.set(id, job);
  return job;
}

function renderJob(job) {
  const parts = [
    `id: ${job.id}`,
    `status: ${job.status}`,
    `command: ${job.command}`,
    `cwd: ${job.cwd}`,
    `exit: ${job.exitCode === null ? '-' : job.exitCode}`,
  ];
  if (job.output.trim()) parts.push(`--- stdout ---\n${job.output.trimEnd()}`);
  if (job.stderr.trim()) parts.push(`--- stderr ---\n${job.stderr.trimEnd()}`);
  if (job.truncated) parts.push('(output truncated)');
  return parts.join('\n');
}

async function shellTool(args) {
  const command = String(args.command || '').trim();
  if (!command) return 'tool error: shell requires "command"';
  const cwd = args.workdir ? String(args.workdir) : process.cwd();
  if (args.background === true) {
    const job = startJob(command, { cwd, timeout: args.timeout ?? 0 });
    return `Started background job ${job.id}\nUse background_output or monitor_output with id "${job.id}" to read it.`;
  }
  const job = startJob(command, { cwd, timeout: args.timeout });
  await new Promise((resolve) => {
    if (job.status !== 'running') {
      resolve();
      return;
    }
    const check = setInterval(() => {
      if (job.status !== 'running') {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
  return renderJob(job);
}

function backgroundOutput(args) {
  const id = String(args.id || args.taskId || '').trim();
  if (!id) return 'tool error: background_output requires "id"';
  const job = jobs.get(id);
  if (!job) return `tool error: no background job "${id}"`;
  return renderJob(job);
}

function backgroundCancel(args) {
  const id = String(args.id || args.taskId || '').trim();
  if (!id) return 'tool error: background_cancel requires "id"';
  const job = jobs.get(id);
  if (!job) return `tool error: no background job "${id}"`;
  if (job.status === 'running') {
    try {
      job.child.kill();
    } catch {
      /* ignore */
    }
    job.status = 'cancelled';
    job.endedAt = Date.now();
  }
  return `Cancelled ${id}`;
}

function monitorList() {
  if (jobs.size === 0) return 'No background jobs.';
  return [...jobs.values()]
    .map(
      (job) =>
        `${job.id}  ${job.status}  ${new Date(job.startedAt).toISOString()}  ${job.command}`
    )
    .join('\n');
}

function monitorStart(args) {
  return shellTool({ ...args, background: true });
}

function monitorStop(args) {
  return backgroundCancel(args);
}

function monitorOutput(args) {
  return backgroundOutput(args);
}

module.exports = {
  shellTool,
  backgroundOutput,
  backgroundCancel,
  monitorList,
  monitorStart,
  monitorStop,
  monitorOutput,
};
