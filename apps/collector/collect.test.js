const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { closeDatabase, listEvents, openDatabase } = require('../storage/database');
const { normalizeEvent, storeEvent } = require('./collect');

function safeCandidate() {
  return {
    task: { id: 'rise-101', title: 'Validate onboarding flow', project: 'Rise', workstream: 'qa' },
    execution: { agent: 'Codex', startedAt: '2026-09-05T18:00:00.000Z', status: 'completed' },
    outcome: { result: 'accepted', retryCount: 0, validation: ['expo export passed'] },
    references: { repository: 'rise-redesign', changedFiles: ['App.js'] },
  };
}

test('normalizes a safe task event', () => {
  const event = normalizeEvent(safeCandidate(), '2026-09-05T19:00:00.000Z');
  assert.equal(event.eventVersion, 1);
  assert.equal(event.outcome.result, 'accepted');
  assert.deepEqual(event.references.changedFiles, ['App.js']);
});

test('rejects sensitive fields before storage', () => {
  const candidate = safeCandidate();
  candidate.execution.apiToken = 'ghp_123456789012345678901234567890';
  assert.throws(() => normalizeEvent(candidate), /privacy policy/);
});

test('stores approved events in the local database', () => {
  const event = normalizeEvent(safeCandidate());
  const databasePath = path.join(__dirname, '../../data/collector.test.sqlite');
  storeEvent(event, databasePath);
  const database = openDatabase(databasePath);
  assert.equal(listEvents(database).length, 1);
  closeDatabase(database);
  require('node:fs').rmSync(databasePath, { force: true });
});
