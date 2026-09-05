const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { closeDatabase, getAgentPerformance, getSummary, listEvents, openDatabase, recordEvent } = require('./database');

const testDatabasePath = path.join(__dirname, '../../data/agent-tracking.test.sqlite');

function event(overrides = {}) {
  return {
    eventVersion: 1,
    eventId: 'event-1',
    recordedAt: '2026-09-05T19:00:00.000Z',
    task: { id: 'rise-101', title: 'Validate onboarding', project: 'Rise', workstream: 'qa' },
    execution: { agent: 'Codex', model: null, startedAt: '2026-09-05T18:00:00.000Z', completedAt: null, status: 'completed' },
    outcome: { result: 'accepted', retryCount: 1, blocker: null, validation: ['expo export passed'] },
    references: { repository: 'rise-redesign', branch: 'main', commit: null, changedFiles: ['App.js'] },
    ...overrides,
  };
}

test('stores queryable normalized events and calculates a summary', () => {
  fs.rmSync(testDatabasePath, { force: true });
  const database = openDatabase(testDatabasePath);
  recordEvent(database, event());
  const events = listEvents(database, { project: 'Rise' });
  const summary = getSummary(database);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].validation, ['expo export passed']);
  assert.equal(summary.totals.completedTasks, 1);
  assert.equal(summary.totals.retries, 1);
  assert.equal(summary.workstreams[0].workstream, 'qa');
  closeDatabase(database);
  fs.rmSync(testDatabasePath, { force: true });
  fs.rmSync(`${testDatabasePath}-wal`, { force: true });
  fs.rmSync(`${testDatabasePath}-shm`, { force: true });
});

test('calculates evidence-based metrics for each assigned agent', () => {
  fs.rmSync(testDatabasePath, { force: true });
  const database = openDatabase(testDatabasePath);
  const assigned = (eventId, status, validation, retries = 0) => ({
    ...event({ eventId, execution: { agent: 'Foundation & Architecture', runtime: 'Codex', model: 'gpt-5.6-terra', startedAt: '2026-09-05T18:00:00.000Z', completedAt: null, status }, assignment: { agentId: 'ats-foundation', role: 'Architecture & delivery' }, outcome: { result: 'accepted', retryCount: retries, blocker: null, validation } }),
  });
  recordEvent(database, assigned('performance-1', 'completed', ['test passed'], 1));
  recordEvent(database, assigned('performance-2', 'failed', [], 0));
  recordEvent(database, assigned('performance-3', 'completed', ['reviewed'], 0));
  const foundation = getAgentPerformance(database).find((agent) => agent.agent_id === 'ats-foundation');
  assert.equal(foundation.totalTasks, 3);
  assert.equal(foundation.completedTasks, 2);
  assert.equal(foundation.failedTasks, 1);
  assert.equal(foundation.completionRate, 67);
  assert.equal(foundation.validationCoverage, 100);
  assert.equal(foundation.hasEnoughData, true);
  closeDatabase(database);
  fs.rmSync(testDatabasePath, { force: true });
  fs.rmSync(`${testDatabasePath}-wal`, { force: true });
  fs.rmSync(`${testDatabasePath}-shm`, { force: true });
});
