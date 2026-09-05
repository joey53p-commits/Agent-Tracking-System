const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { closeDatabase, getSummary, listEvents, openDatabase, recordEvent } = require('./database');

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
