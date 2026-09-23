const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { adaptLifecycleSpool, spoolFileHash } = require('../../packages/lifecycle-adapter');
const { ingestLifecycleSpool } = require('./ingest-lifecycle');
const { closeDatabase, openDatabase, persistLifecycleBatch, persistRolloutBatch } = require('../storage/database');
const { adaptRolloutFile } = require('../../packages/rollout-adapter');

const projects = [{ id: 'tracker', name: 'Agent Tracking System' }];
function hook(overrides = {}) { return { eventId: 'hook-1', source: 'codex-lifecycle-hook', hookEvent: 'SubagentStart', lifecycleState: 'started', projectId: 'tracker', projectName: 'Agent Tracking System', sourceSessionId: 'session_1', sourceTurnId: 'turn_1', sourceAgentId: 'child_1', agentType: 'dashboard_frontend', recordedAt: '2026-09-15T12:00:00.000Z', ...overrides }; }
function fixture(run) { const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-spool-')); const databasePath = path.join(__dirname, `../../data/lifecycle-${randomUUID()}.test.sqlite`); try { return run({ spool, databasePath }); } finally { for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true }); fs.rmSync(spool, { recursive: true, force: true }); } }
function write(spool, value, name = 'event.json') { fs.writeFileSync(path.join(spool, name), JSON.stringify(value)); }

test('a real-hook-shaped frontend child is persisted safely', () => fixture(({ spool, databasePath }) => {
  write(spool, hook()); const result = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath }); const database = openDatabase(databasePath);
  const row = database.prepare('SELECT role_key, lifecycle_state FROM rollout_lifecycle_events').get(); const checkpoint = database.prepare('SELECT observed_file_count FROM lifecycle_source_checkpoints').get(); closeDatabase(database);
  assert.equal(result.persisted, 1); assert.equal(result.linkedTurns, 0); assert.equal(row.role_key, 'frontend'); assert.equal(row.lifecycle_state, 'started'); assert.equal(checkpoint.observed_file_count, 1);
}));

test('an exact session and turn match upgrades an unknown rollout turn to the child role', () => fixture(({ spool, databasePath }) => {
  const rollout = path.join(spool, 'rollout-source.jsonl');
  fs.writeFileSync(rollout, `${JSON.stringify({ type: 'session_meta', timestamp: '2026-09-15T12:00:00.000Z', ordinal: 0, payload: { cwd: 'C:\\project\\tracker', session_id: 'session_1' } })}\n${JSON.stringify({ type: 'token_usage_record', timestamp: '2026-09-15T12:00:01.000Z', ordinal: 1, payload: { thread_id: 'task_1', session_id: 'session_1', turn_id: 'turn_1', response_id: 'response_1', usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } })}`);
  const database = openDatabase(databasePath); persistRolloutBatch(database, { project: projects[0], sourceFileId: 'source_1', adapterResult: adaptRolloutFile(rollout) }); closeDatabase(database);
  write(spool, hook()); const result = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath }); const verify = openDatabase(databasePath);
  assert.equal(result.linkedTurns, 1); assert.equal(verify.prepare('SELECT role_key FROM rollout_turns').get().role_key, 'frontend'); closeDatabase(verify);
}));

test('replaying is idempotent and private or malformed spool records are rejected', () => fixture(({ spool, databasePath }) => {
  write(spool, hook()); write(spool, { ...hook({ eventId: 'hook-2' }), prompt: 'private' }, 'private.json'); write(spool, { no: 'event' }, 'bad.json');
  const first = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath }); const second = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath });
  assert.equal(first.persisted, 1); assert.equal(first.health.malformedRecords, 1); assert.equal(first.health.recordsSkipped, 1);
  assert.equal(second.persisted, 0); assert.equal(second.duplicatesIgnored, 0); assert.equal(second.health.readState, 'caught_up');
}));

test('a failed lifecycle transaction does not advance its checkpoint', () => fixture(({ spool, databasePath }) => {
  write(spool, hook()); const adapterResult = adaptLifecycleSpool(spool, { projects }); const database = openDatabase(databasePath);
  assert.throws(() => persistLifecycleBatch(database, { adapterResult, failAfterEvents: 0 }), /Injected lifecycle transaction failure/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rollout_lifecycle_events').get().count, 0); assert.equal(database.prepare('SELECT COUNT(*) AS count FROM lifecycle_source_checkpoints').get().count, 0); closeDatabase(database);
}));

test('Stop and SessionEnd never infer task completion', () => fixture(({ spool, databasePath }) => {
  write(spool, hook({ hookEvent: 'Stop', lifecycleState: 'turn_stopped' })); write(spool, hook({ eventId: 'hook-2', hookEvent: 'SessionEnd', lifecycleState: 'ended', sourceTurnId: null }), 'end.json');
  assert.equal(ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath }).persisted, 2); const database = openDatabase(databasePath); assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rollout_tasks').get().count, 0); closeDatabase(database);
}));

test('bounded lifecycle scans rotate through more than 128 spool files across ingestion cycles', () => fixture(({ spool, databasePath }) => {
  for (let index = 0; index < 260; index += 1) {
    write(spool, hook({ eventId: `hook-${index}`, sourceTurnId: `turn-${index}` }), `event-${String(index).padStart(3, '0')}.json`);
  }
  const first = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath, maxFiles: 128 });
  const second = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath, maxFiles: 128 });
  const third = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath, maxFiles: 128 });
  const database = openDatabase(databasePath);
  const stored = database.prepare('SELECT COUNT(*) AS count FROM rollout_lifecycle_events').get();
  const checkpoint = database.prepare('SELECT observed_file_count, backlog_file_count, is_partial, last_file_hash FROM lifecycle_source_checkpoints WHERE project_id = ?').get('tracker');
  closeDatabase(database);
  assert.equal(first.persisted, 128);
  assert.equal(first.health.readState, 'partial');
  assert.equal(second.persisted, 128);
  assert.equal(second.health.readState, 'partial');
  assert.equal(third.persisted, 4);
  assert.equal(third.health.readState, 'caught_up');
  assert.equal(stored.count, 260);
  assert.equal(checkpoint.observed_file_count, 260);
  assert.equal(checkpoint.backlog_file_count, 0);
  assert.equal(checkpoint.is_partial, 0);
  assert.equal(checkpoint.last_file_hash, spoolFileHash('event-259.json'));
}));

test('a lexically earlier lifecycle file added after a partial scan is swept before caught up', () => fixture(({ spool, databasePath }) => {
  for (let index = 0; index < 260; index += 1) {
    write(spool, hook({ eventId: `hook-${index}`, sourceTurnId: `turn-${index}` }), `event-${String(index).padStart(3, '0')}.json`);
  }
  const first = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath, maxFiles: 128 });
  write(spool, hook({ eventId: 'hook-earlier', sourceTurnId: 'turn-earlier' }), 'event-000-earlier.json');
  const second = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath, maxFiles: 128 });
  const third = ingestLifecycleSpool({ spoolDirectory: spool, projects, databasePath, maxFiles: 128 });
  const database = openDatabase(databasePath);
  try {
    const stored = database.prepare('SELECT COUNT(*) AS count FROM rollout_lifecycle_events').get();
    const earlier = database.prepare('SELECT event_id FROM rollout_lifecycle_events WHERE event_id = ?').get('hook-earlier');
    assert.equal(first.health.backlogFiles, 132);
    assert.equal(second.health.readState, 'partial');
    assert.equal(second.health.backlogFiles, 5);
    assert.equal(third.health.readState, 'caught_up');
    assert.equal(third.health.backlogFiles, 0);
    assert.equal(earlier.event_id, 'hook-earlier');
    assert.equal(stored.count, 261);
  } finally { closeDatabase(database); }
}));
