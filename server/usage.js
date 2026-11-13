'use strict';

// OpenCode Go usage limits. The API key stays on the backend; the renderer
// only receives the normalized percentages and reset timestamps.

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const CACHE_MS = 60_000;
const USER_AGENT = 'yah/0.3.0';

let cache = { at: 0, key: '', data: null };

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function normalizeMeter(meter) {
  return {
    percent: clampPercent(meter?.percent),
    limited: meter?.status === 'rate-limited',
    resetsAt:
      typeof meter?.resetsAt === 'string' ? meter.resetsAt : null,
  };
}

async function getUsage(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    return { ok: false, error: 'no_api_key' };
  }
  if (cache.data && cache.key === key && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 200);
      return {
        ok: false,
        error: `HTTP ${response.status}${body ? `: ${body}` : ''}`,
      };
    }
    const payload = await response.json();
    const usage = payload?.usage || {};
    const data = {
      ok: true,
      usage: {
        rolling: normalizeMeter(usage.rolling),
        weekly: normalizeMeter(usage.weekly),
        monthly: normalizeMeter(usage.monthly),
      },
      fetchedAt: Date.now(),
    };
    cache = { at: Date.now(), key, data };
    return data;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = { USAGE_URL, getUsage, normalizeMeter, clampPercent };
