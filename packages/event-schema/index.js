const statuses = new Set(['queued', 'in_progress', 'waiting_for_approval', 'blocked', 'failed', 'cancelled', 'completed']);

function validateTaskEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') errors.push('event must be an object');
  if (event?.eventVersion !== 1) errors.push('eventVersion must be 1');
  if (!event?.eventId) errors.push('eventId is required');
  if (!event?.task?.id) errors.push('task.id is required');
  if (!statuses.has(event?.execution?.status)) errors.push('execution.status is invalid');
  return { valid: errors.length === 0, errors };
}

module.exports = { validateTaskEvent, statuses };
