'use strict';

const os = require('node:os');

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
  const language =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    locale ||
    'unknown';
  return { locale: locale || 'unknown', region, language };
}

function safeUser() {
  try {
    return os.userInfo();
  } catch {
    return { username: 'unknown' };
  }
}

function gb(bytes) {
  return Math.round((Number(bytes) / 1024 / 1024 / 1024) * 10) / 10;
}

function timezoneLocation(timezone) {
  const parts = String(timezone || '')
    .split('/')
    .filter(Boolean);
  return {
    area: parts.length > 1 ? parts[0].replace(/_/g, ' ') : '',
    city:
      parts.length > 1
        ? parts[parts.length - 1].replace(/_/g, ' ')
        : '',
  };
}

function systemInfoTool() {
  const now = new Date();
  const locale = localeInfo();
  const cpus = os.cpus();
  const user = safeUser();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const shell =
    process.env.ComSpec || process.env.SHELL || process.env.SHELL_PATH || '';
  const timezone =
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
      } catch {
        return 'unknown';
      }
    })();
  const tzLocation = timezoneLocation(timezone);
  const info = {
    now: {
      iso: now.toISOString(),
      date: formatDate(now),
      time: formatTime(now),
      local: `${formatDate(now)} ${formatTime(now)}`,
      timezone,
      offset: formatOffset(now),
      utc: now.toISOString(),
    },
    location: {
      cwd: process.cwd(),
      home: os.homedir(),
      hostname: os.hostname(),
      timezone,
      area: tzLocation.area || null,
      city: tzLocation.city || null,
      localeRegion: locale.region || null,
    },
    os: {
      platform: os.platform(),
      type: os.type(),
      release: os.release(),
      version: typeof os.version === 'function' ? os.version() : '',
      arch: os.arch(),
    },
    language: {
      locale: locale.locale,
      region: locale.region || null,
      system: locale.language,
    },
    user: {
      name: user.username || 'unknown',
      shell,
    },
    cpu: {
      model: cpus[0]?.model?.trim() || 'unknown',
      cores: cpus.length,
    },
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      totalGb: gb(totalMemory),
      freeGb: gb(freeMemory),
    },
    runtime: {
      node: process.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      systemUptimeSeconds: Math.round(os.uptime()),
    },
  };
  return JSON.stringify(info, null, 2);
}

module.exports = { systemInfoTool };
