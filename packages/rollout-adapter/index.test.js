const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { adaptRolloutFile, rolloutMetadataDiscovery } = require('./index');

function sourceRecord(overrides = {}) {
  return {
    type: 'token_usage_record',
    timestamp: '2026-09-11T16:00:00.000Z',
    ordinal: 1,
    payload: {
      thread_id: 'task_real', session_id: 'session_real', turn_id: 'turn_real', response_id: 'response_real',
      usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15, reasoning_output_tokens: 99 },
      thread_token_usage: { input_tokens: 999, output_tokens: 1, total_tokens: 1000 },
    },
    ...overrides,
  };
}

function withFixture(records, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-adapter-'));
  const file = path.join(directory, 'rollout.jsonl');
  fs.writeFileSync(file, records.map((record) => typeof record === 'string' ? record : JSON.stringify(record)).join('\n'));
  try { return run(file); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('an allowlisted real-source-shaped record becomes a normalized turn', () => withFixture([sourceRecord()], (file) => {
  const result = adaptRolloutFile(file, { agent: { name: 'dashboard_frontend' } });
  assert.equal(result.health.recordsAccepted, 1);
  assert.deepEqual(result.turns[0].usage, { inputTokens: 11, outputTokens: 4, totalTokens: 15 });
  assert.equal(result.turns[0].agent.key, 'frontend');
}));

test('a record without exact per-response usage is reported as unavailable', () => withFixture([
  sourceRecord({ payload: { thread_id: 'task_real', session_id: 'session_real', turn_id: 'turn_real', response_id: 'response_real' } }),
], (file) => {
  const result = adaptRolloutFile(file);
  assert.equal(result.health.recordsWithoutUsableUsage, 1);
  assert.equal(result.turns.length, 0);
}));

test('unsupported and malformed records are skipped safely', () => withFixture([
  { type: 'event_msg', payload: { message: 'ignored' } }, '{not valid json}',
], (file) => {
  const result = adaptRolloutFile(file);
  assert.equal(result.health.recordsSkipped, 1);
  assert.equal(result.health.malformedRecords, 1);
  assert.equal(result.turns.length, 0);
}));

test('a checkpoint reads only appended bytes from a growing file', () => withFixture([sourceRecord()], (file) => {
  const first = adaptRolloutFile(file);
  const initialSize = fs.statSync(file).size;
  fs.appendFileSync(file, `\n${JSON.stringify(sourceRecord({ payload: { ...sourceRecord().payload, turn_id: 'turn_next', response_id: 'response_next' } }))}`);
  const second = adaptRolloutFile(file, { checkpoint: first.nextCheckpoint });
  assert.equal(first.nextCheckpoint.offset, initialSize);
  assert.ok(second.health.bytesRead < fs.statSync(file).size);
  assert.equal(second.health.recordsAccepted, 1);
}));

test('a source that grows during adaptation remains partial with the final file size checkpointed', () => withFixture([sourceRecord()], (file) => {
  const initial = fs.statSync(file);
  const final = { ...initial, size: initial.size + 23, mtime: initial.mtime };
  let calls = 0;
  const result = adaptRolloutFile(file, { statSync: () => (++calls === 1 ? initial : final) });
  assert.equal(calls, 2);
  assert.equal(result.health.pendingBytes, 23);
  assert.equal(result.health.readState, 'partial');
  assert.equal(result.nextCheckpoint.fileSize, final.size);
  assert.ok(result.nextCheckpoint.offset < result.nextCheckpoint.fileSize);
}));

test('a large checkpoint backlog is processed in bounded chunks without skipping ahead', () => withFixture([sourceRecord()], (file) => {
  const first = adaptRolloutFile(file, { maxBytes: 500 });
  fs.appendFileSync(file, `\n${Array.from({ length: 20 }, (_, index) => JSON.stringify(sourceRecord({ payload: { ...sourceRecord().payload, turn_id: `turn_${index}`, response_id: `response_${index}` } }))).join('\n')}`);
  const second = adaptRolloutFile(file, { checkpoint: first.nextCheckpoint, maxBytes: 500 });
  assert.ok(second.health.bytesRead >= 500);
  assert.ok(second.health.bytesRead < fs.statSync(file).size);
  assert.equal(second.health.readState, 'partial');
  assert.ok(second.nextCheckpoint.offset < second.nextCheckpoint.fileSize);
}));

test('an overlong envelope advances safely so a later response can be ingested', () => withFixture([
  { type: 'event_msg', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 1, payload: { content: 'x'.repeat(1000) } },
  sourceRecord({ payload: { ...sourceRecord().payload, response_id: 'response_after_large' } }),
], (file) => {
  const first = adaptRolloutFile(file, { maxBytes: 1000 });
  const second = adaptRolloutFile(file, { checkpoint: first.nextCheckpoint, maxBytes: 1000 });
  const third = adaptRolloutFile(file, { checkpoint: second.nextCheckpoint, maxBytes: 1000 });
  assert.equal(first.health.overlongPending, true);
  assert.equal(second.health.overlongRecords, 1);
  assert.equal(third.health.recordsAccepted, 1);
  assert.equal(third.health.readState, 'caught_up');
}));

test('an unfinished overlong scan stays bounded and reports incomplete health', () => withFixture([
  { type: 'event_msg', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 1, payload: { content: 'x'.repeat(10000) } },
], (file) => {
  const result = adaptRolloutFile(file, { maxBytes: 1000 });
  assert.equal(result.health.overlongPending, true);
  assert.equal(result.health.bytesRead, 1000);
  assert.equal(result.nextCheckpoint.offset, 0);
  assert.equal(result.nextCheckpoint.openEnvelope.scanOffset, 1000);
}));

test('a multi-chunk unfinished envelope resumes safely and emits a later exact response once', () => withFixture([
  { type: 'event_msg', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 1, payload: { content: 'x'.repeat(3500) } },
  sourceRecord({ payload: { ...sourceRecord().payload, response_id: 'response_after_resumed_large' } }),
], (file) => {
  let checkpoint;
  let accepted = 0;
  let maximumRead = 0;
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const result = adaptRolloutFile(file, { checkpoint, maxBytes: 1000 });
    accepted += result.health.recordsAccepted;
    maximumRead = Math.max(maximumRead, result.health.bytesRead);
    checkpoint = result.nextCheckpoint;
    if (result.health.readState === 'caught_up') break;
  }
  assert.equal(accepted, 1);
  assert.equal(maximumRead, 1000);
  assert.equal(checkpoint.openEnvelope, undefined);
}));

test('UTF-8 byte checkpoints resume across non-ASCII content before and inside an overlong envelope', () => withFixture([
  { type: 'session_meta', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 0, payload: { cwd: 'C:\\project\\träckér', session_id: 'session_unicode' } },
  { type: 'event_msg', timestamp: '2026-09-11T16:00:01.000Z', ordinal: 1, payload: { content: '漢'.repeat(1800) } },
  sourceRecord({ payload: { ...sourceRecord().payload, session_id: 'session_unicode', response_id: 'response_after_unicode_resume' } }),
], (file) => {
  let checkpoint;
  let accepted = 0;
  const fileSize = fs.statSync(file).size;
  for (let cycle = 0; cycle < 10; cycle += 1) {
    const result = adaptRolloutFile(file, { checkpoint, maxBytes: 1000 });
    accepted += result.health.recordsAccepted;
    checkpoint = result.nextCheckpoint;
    assert.ok(checkpoint.offset <= fileSize);
    if (checkpoint.openEnvelope) {
      assert.ok(checkpoint.openEnvelope.startOffset >= checkpoint.offset);
      assert.ok(checkpoint.openEnvelope.scanOffset > checkpoint.openEnvelope.startOffset);
    }
    if (result.health.readState === 'caught_up') break;
  }
  assert.equal(accepted, 1);
  assert.equal(checkpoint.offset, fileSize);
  assert.equal(checkpoint.openEnvelope, undefined);
}));

test('a malformed complete envelope advances the checkpoint safely', () => withFixture([
  '{"type":"event_msg","timestamp":"x","ordinal":1,"payload":{bad}}', sourceRecord(),
], (file) => {
  const first = adaptRolloutFile(file, { maxBytes: 1000 });
  const second = adaptRolloutFile(file, { checkpoint: first.nextCheckpoint, maxBytes: 1000 });
  assert.equal(first.health.malformedRecords, 1);
  assert.equal(first.health.recordsAccepted, 1);
  assert.equal(second.health.recordsAccepted, 0);
  assert.equal(second.health.readState, 'caught_up');
}));

test('privacy filtering emits no raw fields from a source record', () => withFixture([
  sourceRecord({ payload: { ...sourceRecord().payload, prompt: 'never emitted', thread_token_usage: { input_tokens: 999, output_tokens: 1, total_tokens: 1000 } } }),
], (file) => {
  const result = adaptRolloutFile(file, { agent: { path: '/root/dashboard_frontend' } });
  const emitted = JSON.stringify(result);
  assert.doesNotMatch(emitted, /prompt|thread_token_usage|reasoning_output_tokens|dashboard_frontend|never emitted/);
}));

test('metadata past the bounded scan is safely marked incomplete rather than ignored', () => withFixture([
  { type: 'event_msg', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 0, payload: { content: 'x'.repeat(1024) } },
  { type: 'session_meta', timestamp: '2026-09-11T16:00:01.000Z', ordinal: 1, payload: { cwd: 'C:\\project\\tracker', session_id: 'late_session' } },
], (file) => {
  const result = rolloutMetadataDiscovery(file, [{ id: 'tracker', name: 'Tracker', paths: ['C:\\project\\tracker'] }], (cwd, projects) => projects.find((project) => project.paths.includes(cwd)) || null, 128);
  assert.deepEqual(result, { state: 'incomplete', metadata: null });
}));
