const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { ingestRolloutFile } = require('./ingest-rollout');
const { closeDatabase, getLatestRolloutHealth, getRolloutCheckpoint, getRolloutOverview, listRolloutTasks, listRolloutTurns, openDatabase, persistRolloutBatch } = require('../storage/database');
const { adaptRolloutFile, sourceFileId } = require('../../packages/rollout-adapter');

const projects = [{ id: 'tracker', name: 'Agent Tracking System', paths: ['C:\\project\\tracker'] }];
const projectResolver = (cwd, registered) => registered.find((project) => project.paths.includes(cwd)) || null;

function sourceRecord(overrides = {}) {
  return {
    type: 'token_usage_record', timestamp: '2026-09-11T16:00:01.000Z', ordinal: 1, payload: {
      thread_id: 'task_1', session_id: 'session_1', turn_id: 'turn_1', response_id: 'response_1',
      usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 },
    }, ...overrides,
  };
}

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-ingest-'));
  const rollout = path.join(directory, 'rollout.jsonl');
  const databasePath = path.join(__dirname, `../../data/rollout-ingest-${randomUUID()}.test.sqlite`);
  fs.rmSync(databasePath, { force: true });
  fs.writeFileSync(rollout, [JSON.stringify({ type: 'session_meta', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 0, payload: { cwd: 'C:\\project\\tracker', session_id: 'source_session_1' } }), JSON.stringify(sourceRecord())].join('\n'));
  try { return run({ rollout, databasePath }); } finally {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('one real-source-shaped response persists once and can be queried', () => fixture(({ rollout, databasePath }) => {
  const result = ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: projectResolver, databasePath });
  const database = openDatabase(databasePath);
  const [task] = listRolloutTasks(database, { projectId: 'tracker' });
  const [turn] = listRolloutTurns(database, { taskId: task.task_id });
  closeDatabase(database);
  assert.equal(result.persisted, 1);
  assert.equal(task.total_tokens, 15);
  assert.equal(task.isComplete, false);
  assert.equal(turn.usageExact, true);
}));

test('rerunning ingestion does not double-count a response across restarts', () => fixture(({ rollout, databasePath }) => {
  ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: projectResolver, databasePath });
  const second = ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: projectResolver, databasePath });
  const database = openDatabase(databasePath);
  const [task] = listRolloutTasks(database);
  closeDatabase(database);
  assert.equal(second.persisted, 0);
  assert.equal(task.total_tokens, 15);
}));

test('a failed transaction does not advance the checkpoint', () => fixture(({ rollout, databasePath }) => {
  const adapterResult = adaptRolloutFile(rollout);
  const database = openDatabase(databasePath);
  assert.throws(() => persistRolloutBatch(database, {
    project: { id: 'tracker', name: 'Agent Tracking System' }, sourceFileId: sourceFileId('source_session_1'), adapterResult, failAfterTurns: 0,
  }), /Injected transaction failure/);
  assert.equal(getRolloutCheckpoint(database, 'tracker', sourceFileId('source_session_1')), null);
  assert.equal(listRolloutTurns(database).length, 0);
  closeDatabase(database);
}));

test('project attribution stores project ID and name but never its path', () => fixture(({ rollout, databasePath }) => {
  ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: projectResolver, databasePath });
  const database = openDatabase(databasePath);
  const serialized = JSON.stringify({ tasks: listRolloutTasks(database), turns: listRolloutTurns(database), health: getLatestRolloutHealth(database, 'tracker') });
  closeDatabase(database);
  assert.match(serialized, /Agent Tracking System/);
  assert.doesNotMatch(serialized, /C:\\\\project\\\\tracker/);
}));

test('privacy checks prevent forbidden data from entering SQLite', () => fixture(({ rollout, databasePath }) => {
  const adapterResult = adaptRolloutFile(rollout);
  adapterResult.turns[0] = { ...adapterResult.turns[0], prompt: 'private' };
  const database = openDatabase(databasePath);
  assert.throws(() => persistRolloutBatch(database, {
    project: { id: 'tracker', name: 'Agent Tracking System' }, sourceFileId: sourceFileId('source_session_1'), adapterResult,
  }), /excluded field/);
  assert.equal(listRolloutTurns(database).length, 0);
  closeDatabase(database);
}));

test('an active task remains visibly incomplete after persistence', () => fixture(({ rollout, databasePath }) => {
  ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: projectResolver, databasePath });
  const database = openDatabase(databasePath);
  const [task] = listRolloutTasks(database);
  closeDatabase(database);
  assert.equal(task.status, 'active');
  assert.equal(task.isComplete, false);
}));

test('a registered source that disappears after discovery persists safe partial source health', () => fixture(({ rollout, databasePath }) => {
  const metadata = { project: { id: 'tracker', name: 'Agent Tracking System' }, sourceFileId: sourceFileId('source_session_1') };
  fs.rmSync(rollout);
  const result = ingestRolloutFile({ filePath: rollout, metadata, projects, registeredProjectForPath: projectResolver, databasePath });
  const database = openDatabase(databasePath);
  try {
    const health = getLatestRolloutHealth(database, 'tracker');
    assert.equal(result.readFailure, true);
    assert.equal(result.persisted, 0);
    assert.equal(health.read_state, 'partial');
    assert.equal(health.pending_bytes, 0);
    const overviewHealth = getRolloutOverview(database).projects[0].sourceHealth;
    assert.equal(overviewHealth.latestIngestionAt, health.observed_at);
    assert.equal(overviewHealth.freshnessState, 'stale');
    assert.equal(overviewHealth.readState, 'partial');
    assert.equal(overviewHealth.pendingBytes, 0);
    assert.doesNotMatch(JSON.stringify({ result, health }), /rollout-ingest-|C:\\project\\tracker/);
  } finally { closeDatabase(database); }
}));

test('a persisted continuation checkpoint resumes a large unfinished envelope without duplicate response storage', () => fixture(({ rollout, databasePath }) => {
  fs.writeFileSync(rollout, [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 0, payload: { cwd: 'C:\\project\\tracker', session_id: 'source_session_1' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-09-11T16:00:01.000Z', ordinal: 1, payload: { content: 'x'.repeat(3500) } }),
    JSON.stringify(sourceRecord({ payload: { ...sourceRecord().payload, response_id: 'response_after_checkpointed_large' } })),
  ].join('\n'));
  let persisted = 0;
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const result = ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: projectResolver, databasePath, maxBytes: 1000 });
    persisted += result.persisted;
    if (result.health.readState === 'caught_up') break;
  }
  const database = openDatabase(databasePath);
  try {
    const checkpoint = getRolloutCheckpoint(database, 'tracker', sourceFileId('source_session_1'));
    assert.equal(persisted, 1);
    assert.equal(listRolloutTurns(database).length, 1);
    assert.equal(checkpoint.openEnvelope, undefined);
  } finally { closeDatabase(database); }
}));

test('a persisted UTF-8 checkpoint resumes past non-ASCII content without duplicate response storage', () => fixture(({ rollout, databasePath }) => {
  fs.writeFileSync(rollout, [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-09-11T16:00:00.000Z', ordinal: 0, payload: { cwd: 'C:\\project\\tracker', session_id: 'source_session_1' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-09-11T16:00:01.000Z', ordinal: 1, payload: { content: 'é'.repeat(2200) } }),
    JSON.stringify(sourceRecord({ payload: { ...sourceRecord().payload, response_id: 'response_after_utf8_checkpoint' } })),
  ].join('\n'));
  let persisted = 0;
  let finalResult;
  for (let cycle = 0; cycle < 12; cycle += 1) {
    finalResult = ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: projectResolver, databasePath, maxBytes: 1000 });
    persisted += finalResult.persisted;
    if (finalResult.health.readState === 'caught_up') break;
  }
  const database = openDatabase(databasePath);
  try {
    assert.equal(finalResult.health.readState, 'caught_up');
    assert.equal(persisted, 1);
    assert.equal(listRolloutTurns(database).length, 1);
  } finally { closeDatabase(database); }
}));
