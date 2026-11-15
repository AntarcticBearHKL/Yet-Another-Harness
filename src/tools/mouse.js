'use strict';

const { execFile } = require('node:child_process');

const MOUSE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YahMouse {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  public struct POINT { public int X; public int Y; }
}
'@
try { [void][YahMouse]::SetProcessDpiAwarenessContext([IntPtr]-4) } catch { }

function Get-Cursor {
  $point = New-Object YahMouse+POINT
  if (-not [YahMouse]::GetCursorPos([ref]$point)) {
    throw 'GetCursorPos failed'
  }
  return $point
}

function Move-To([int]$x, [int]$y) {
  if (-not [YahMouse]::SetCursorPos($x, $y)) {
    throw "SetCursorPos($x,$y) failed"
  }
}

function Mouse-Flags([string]$button) {
  switch ($button) {
    'right' { return @(0x0008, 0x0010) }
    'middle' { return @(0x0020, 0x0040) }
    default { return @(0x0002, 0x0004) }
  }
}

$action = [string]$env:YAH_MOUSE_ACTION
$button = [string]$env:YAH_MOUSE_BUTTON
$hasX = -not [string]::IsNullOrWhiteSpace($env:YAH_MOUSE_X)
$hasY = -not [string]::IsNullOrWhiteSpace($env:YAH_MOUSE_Y)
$hasToX = -not [string]::IsNullOrWhiteSpace($env:YAH_MOUSE_TO_X)
$hasToY = -not [string]::IsNullOrWhiteSpace($env:YAH_MOUSE_TO_Y)
$flags = Mouse-Flags $button

switch ($action) {
  'position' {
  }
  'move' {
    Move-To ([int]$env:YAH_MOUSE_X) ([int]$env:YAH_MOUSE_Y)
  }
  'click' {
    if ($hasX -and $hasY) {
      Move-To ([int]$env:YAH_MOUSE_X) ([int]$env:YAH_MOUSE_Y)
    }
    $count = [int]$env:YAH_MOUSE_COUNT
    if ($count -lt 1) { $count = 1 }
    for ($i = 0; $i -lt $count; $i++) {
      [YahMouse]::mouse_event([uint32]$flags[0], 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 25
      [YahMouse]::mouse_event([uint32]$flags[1], 0, 0, 0, [UIntPtr]::Zero)
      if ($i -lt $count - 1) { Start-Sleep -Milliseconds 60 }
    }
  }
  'drag' {
    if ($hasX -and $hasY) {
      Move-To ([int]$env:YAH_MOUSE_X) ([int]$env:YAH_MOUSE_Y)
    }
    $start = Get-Cursor
    $endX = [int]$env:YAH_MOUSE_TO_X
    $endY = [int]$env:YAH_MOUSE_TO_Y
    $duration = [int]$env:YAH_MOUSE_DURATION
    if ($duration -lt 0) { $duration = 0 }
    $steps = [int]($duration / 15)
    if ($steps -lt 1) { $steps = 1 }
    if ($steps -gt 60) { $steps = 60 }
    $sleep = [int]($duration / $steps)
    [YahMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    try {
      for ($i = 1; $i -le $steps; $i++) {
        $x = [int]($start.X + ($endX - $start.X) * $i / $steps)
        $y = [int]($start.Y + ($endY - $start.Y) * $i / $steps)
        Move-To $x $y
        if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
      }
    } finally {
      [YahMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
  'scroll' {
    $delta = [int]$env:YAH_MOUSE_DELTA
    [YahMouse]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero)
  }
  default {
    throw "unknown mouse action: $action"
  }
}

$point = Get-Cursor
$result = [ordered]@{
  ok = $true
  action = $action
  x = $point.X
  y = $point.Y
}
if ($action -eq 'scroll') { $result.delta = [int]$env:YAH_MOUSE_DELTA }
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
`;

const ACTIONS = new Set(['move', 'click', 'drag', 'scroll', 'position']);
const BUTTONS = new Set(['left', 'right', 'middle']);

function integer(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function requireInt(value, name) {
  const parsed = integer(value);
  if (parsed === null) throw new Error(`"${name}" must be a number`);
  return parsed;
}

function runPowerShell(env) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        MOUSE_SCRIPT,
      ],
      {
        env: { ...process.env, ...env },
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim();
          reject(new Error(detail || 'mouse command failed'));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

async function mouseTool(args = {}) {
  if (process.platform !== 'win32') {
    throw new Error('mouse is only supported on Windows');
  }
  const action = String(args.action || '').trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    throw new Error(
      `"action" must be one of ${[...ACTIONS].join(', ')}`
    );
  }
  const env = { YAH_MOUSE_ACTION: action };
  const button = String(args.button || 'left').trim().toLowerCase();
  if (!BUTTONS.has(button)) {
    throw new Error(`"button" must be one of ${[...BUTTONS].join(', ')}`);
  }
  env.YAH_MOUSE_BUTTON = button;

  if (action === 'move' || action === 'click' || action === 'drag') {
    const hasX = args.x !== undefined && args.x !== null && args.x !== '';
    const hasY = args.y !== undefined && args.y !== null && args.y !== '';
    if (hasX !== hasY) throw new Error('x and y must be provided together');
    if (hasX) {
      env.YAH_MOUSE_X = String(requireInt(args.x, 'x'));
      env.YAH_MOUSE_Y = String(requireInt(args.y, 'y'));
    } else if (action === 'move') {
      throw new Error('move requires x and y');
    }
  }

  if (action === 'drag') {
    env.YAH_MOUSE_TO_X = String(requireInt(args.to_x, 'to_x'));
    env.YAH_MOUSE_TO_Y = String(requireInt(args.to_y, 'to_y'));
    const duration = integer(args.duration_ms, 350);
    env.YAH_MOUSE_DURATION = String(
      Math.max(0, Math.min(5000, duration))
    );
  }

  if (action === 'click') {
    const count = integer(args.count, 1);
    env.YAH_MOUSE_COUNT = String(Math.max(1, Math.min(3, count)));
  }

  if (action === 'scroll') {
    const delta = integer(args.delta, 120);
    if (delta === 0) throw new Error('"delta" must not be zero');
    env.YAH_MOUSE_DELTA = String(Math.max(-1200, Math.min(1200, delta)));
  }

  const stdout = await runPowerShell(env);
  const line = stdout.split(/\r?\n/).filter(Boolean).pop() || '';
  let result;
  try {
    result = JSON.parse(line);
  } catch {
    throw new Error(line || 'mouse command returned no result');
  }
  if (!result?.ok) throw new Error('mouse command failed');

  if (action === 'position') {
    return `cursor: ${result.x}, ${result.y}`;
  }
  if (action === 'click') {
    const count = integer(args.count, 1);
    return `mouse ${button} click${count > 1 ? ` x${count}` : ''}: ${
      result.x
    }, ${result.y}`;
  }
  if (action === 'drag') {
    return `mouse drag: ${result.x}, ${result.y}`;
  }
  if (action === 'scroll') {
    return `mouse scroll ${result.delta}: ${result.x}, ${result.y}`;
  }
  return `mouse ${action}: ${result.x}, ${result.y}`;
}

module.exports = { mouseTool };
