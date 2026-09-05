const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeEvent, writeEvent } = require('./collect');

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

test('writes newline-delimited events to the approved event directory', () => {
  const event = normalizeEvent(safeCandidate());
  const outputDirectory = path.join(__dirname, '../../data/events');
  const outputPath = writeEvent(event, outputDirectory);
  assert.equal(fs.existsSync(outputPath), true);
  fs.rmSync(path.join(__dirname, '../../data/events'), { recursive: true, force: true });
});
