'use strict';

const REASONING_EFFORTS = ['low', 'high', 'max'];
const DEFAULT_REASONING_EFFORT = 'high';

function normalizeReasoningEffort(value) {
  const effort = String(value || '').trim().toLowerCase();
  return REASONING_EFFORTS.includes(effort)
    ? effort
    : DEFAULT_REASONING_EFFORT;
}

module.exports = {
  REASONING_EFFORTS,
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
};
