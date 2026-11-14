'use strict';

const os = require('node:os');
const path = require('node:path');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
}

function formatOffset(date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function timezoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
}

function localeInfo() {
  let locale = '';
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    /* ignore */
  }
  let region = '';
  if (locale) {
    try {
      region = new Intl.Locale(locale).region || '';
    } catch {
      /* ignore */
    }
  }
  return {
    locale: locale || 'unknown',
    region,
    system:
      process.env.LC_ALL ||
      process.env.LC_MESSAGES ||
      process.env.LANG ||
      locale ||
      'unknown',
  };
}

function displayName(type, code) {
  if (!code) return '';
  try {
    return new Intl.DisplayNames(['en'], { type }).of(code) || '';
  } catch {
    return '';
  }
}

function timezoneLocation(timezone) {
  const parts = String(timezone || '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 1].replace(/_/g, ' ');
}

function locationText(locale) {
  const timezone = timezoneName();
  const city = timezoneLocation(timezone);
  const place = city || displayName('region', locale.region);
  if (!place) {
    return timezone === 'unknown'
      ? 'unavailable'
      : `approximate timezone ${timezone}`;
  }
  return `${place} (approximate, from timezone ${timezone})`;
}

function osText() {
  const platform = os.platform();
  const release = os.release();
  const version = typeof os.version === 'function' ? os.version() : '';
  let name = '';
  if (platform === 'win32') name = version || `Windows ${release}`;
  else if (platform === 'darwin') name = `macOS ${release}`;
  else if (platform === 'linux') name = `Linux ${release}`;
  else name = `${os.type()} ${release}`;
  return `${name} (${platform}, ${os.arch()})`;
}

function shellText() {
  const raw = String(
    process.env.ComSpec || process.env.SHELL || process.env.SHELL_PATH || ''
  ).trim();
  if (!raw) return 'unknown';
  const base = path.basename(raw);
  return base && base !== raw ? `${base} (${raw})` : raw;
}

function languageText(locale) {
  const name = displayName('language', locale.locale);
  return name ? `${locale.locale} (${name})` : locale.locale;
}

function workingDirectory(args, context) {
  const fromContext =
    context?.cwd || (Array.isArray(context?.allowedDirs) ? context.allowedDirs[0] : '');
  const value = String(fromContext || args?.cwd || process.cwd()).trim();
  return value || process.cwd();
}

function systemInfoTool(args = {}, context = {}) {
  const now = new Date();
  const locale = localeInfo();
  const cwd = workingDirectory(args, context);
  return [
    `Date: ${formatDate(now)}`,
    `Time: ${formatTime(now)} (UTC${formatOffset(now)})`,
    `Location: ${locationText(locale)}`,
    `OS: ${osText()}`,
    `Shell: ${shellText()}`,
    `Working directory: ${cwd}`,
    `Working directory rule: only files inside ${cwd} may be read or written; accessing anything outside it requires manual user approval.`,
    `System language: ${languageText(locale)}`,
  ].join('\n');
}

module.exports = { systemInfoTool };
