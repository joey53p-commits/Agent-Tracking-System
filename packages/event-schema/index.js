const statuses = new Set(['queued', 'in_progress', 'waiting_for_approval', 'blocked', 'failed', 'cancelled', 'completed']);
const outcomes = new Set(['accepted', 'needs_review', 'reworked', 'not_applicable', 'unknown']);

const requiredStringPaths = [
  ['eventId', 'eventId'],
  ['recordedAt', 'recordedAt'],
  ['task', 'id'],
  ['task', 'title'],
  ['task', 'project'],
  ['task', 'workstream'],
  ['execution', 'agent'],
  ['execution', 'startedAt'],
  ['execution', 'status'],
  ['outcome', 'result'],
];

function validateTaskEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') errors.push('event must be an object');
  if (event?.eventVersion !== 1) errors.push('eventVersion must be 1');
  for (const [parent, key] of requiredStringPaths) {
    const value = parent === key ? event?.[key] : event?.[parent]?.[key];
    if (typeof value !== 'string' || !value.trim()) errors.push(`${parent === key ? key : `${parent}.${key}`} is required`);
  }
  if (!statuses.has(event?.execution?.status)) errors.push('execution.status is invalid');
  if (!outcomes.has(event?.outcome?.result)) errors.push('outcome.result is invalid');
  if (!Array.isArray(event?.outcome?.validation)) errors.push('outcome.validation must be an array');
  if (!Number.isInteger(event?.outcome?.retryCount) || event.outcome.retryCount < 0) {
    errors.push('outcome.retryCount must be a non-negative integer');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateTaskEvent, statuses, outcomes };
