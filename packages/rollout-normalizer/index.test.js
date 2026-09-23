const assert = require('node:assert/strict');
const test = require('node:test');
const { aggregateAgentUsage, createRolloutNormalizer } = require('./index');

function response(overrides = {}) {
  return {
    source: 'codex_rollout', taskId: 'task_1', sessionId: 'session_1', turnId: 'turn_1', responseId: 'response_1',
    taskStatus: 'active', agent: { name: 'dashboard_frontend' },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ...overrides,
  };
}

test('two turns in one task total exactly from those turns', () => {
  const normalizer = createRolloutNormalizer();
  normalizer.add(response());
  normalizer.add(response({ turnId: 'turn_2', responseId: 'response_2', usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } }));
  const [task] = normalizer.snapshot().tasks;
  assert.deepEqual(task.usage, { inputTokens: 17, outputTokens: 8, totalTokens: 25 });
  assert.equal(task.turnCount, 2);
});

test('a duplicate response ID does not double-count', () => {
  const normalizer = createRolloutNormalizer();
  normalizer.add(response());
  assert.equal(normalizer.add(response({ turnId: 'turn_2' })).accepted, false);
  assert.equal(normalizer.snapshot().tasks[0].usage.totalTokens, 15);
});

test('a completed task retains its exact total', () => {
  const normalizer = createRolloutNormalizer();
  normalizer.add(response({ taskStatus: 'completed' }));
  const late = normalizer.add(response({ turnId: 'turn_2', responseId: 'response_2', usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } }));
  assert.equal(late.reason, 'completed-task');
  assert.deepEqual(normalizer.snapshot().tasks[0].usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test('an active task is visibly incomplete', () => {
  const normalizer = createRolloutNormalizer();
  normalizer.add(response());
  assert.deepEqual(normalizer.snapshot().tasks[0], {
    taskId: 'codex_rollout::task::task_1', status: 'active', isComplete: false,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, turnCount: 1,
  });
});

test('a guardian usage stays separate from project-agent totals', () => {
  const normalizer = createRolloutNormalizer();
  normalizer.add(response());
  normalizer.add(response({ turnId: 'turn_2', responseId: 'response_2', agent: { name: 'guardian', path: '/system/guardian', origin: 'system' } }));
  const totals = aggregateAgentUsage(normalizer.snapshot().turns);
  assert.equal(totals.projectAgents[0].usage.totalTokens, 15);
  assert.equal(totals.systemGuardians[0].usage.totalTokens, 15);
});

test('a long thread total is never copied to an individual task', () => {
  const normalizer = createRolloutNormalizer();
  normalizer.add(response({ taskId: 'task_a', responseId: 'response_a', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } }));
  assert.throws(() => normalizer.add(response({
    taskId: 'task_b', turnId: 'turn_b', responseId: 'response_b', threadUsage: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
  })), /threadUsage is excluded/);
  const taskA = normalizer.snapshot().tasks.find((task) => task.taskId.endsWith('task_a'));
  assert.equal(taskA.usage.totalTokens, 3);
});
