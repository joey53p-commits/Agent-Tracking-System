const assert = require('node:assert/strict');
const test = require('node:test');
const { roleForSource } = require('./index');

test('classifies a named frontend child from its source-agent path', () => {
  const identity = roleForSource({ agentPath: '/root/release/dashboard_frontend', agentName: 'child-42' });
  assert.deepEqual(identity, {
    key: 'frontend', label: 'Frontend', population: 'project_agent', countedInProjectTotals: true, match: 'registry-alias',
  });
});

test('classifies a named backend child from its source-agent name', () => {
  const identity = roleForSource({ agentPath: '/root/release/child-7', agentName: 'backend_integrations' });
  assert.equal(identity.key, 'backend');
  assert.equal(identity.countedInProjectTotals, true);
});

test('keeps an unknown child honest instead of guessing a role', () => {
  const identity = roleForSource({ agentPath: '/root/release/research_child', agentName: 'research_child' });
  assert.deepEqual(identity, {
    key: 'unknown', label: 'Unknown role', population: 'project_agent', countedInProjectTotals: true, match: 'unknown',
  });
});

test('excludes a system guardian from project-agent totals', () => {
  const identity = roleForSource({ agentPath: '/system/guardian', agentName: 'guardian', origin: 'system' });
  assert.equal(identity.population, 'system_guardian');
  assert.equal(identity.countedInProjectTotals, false);
  assert.equal(identity.key, 'unknown');
});
