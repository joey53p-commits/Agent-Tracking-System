const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { CHUNK_BYTES, backfillRolloutAttributionFile } = require('./backfill-rollout-attribution');
const { ingestRolloutFile } = require('./ingest-rollout');
const {
  closeDatabase, getLatestMonitorCycleStatus, getLatestRolloutHealth, getRolloutCheckpoint,
  getRolloutOverview, listRolloutTurns, openDatabase, persistMonitorCycleStatus,
} = require('../storage/database');

const project = { id: 'tracker', name: 'Agent Tracking System', paths: ['C:\\project\\tracker'] };
const projects = [project];
const resolveProject = (cwd, registered) => registered.find((candidate) => candidate.paths.includes(cwd)) || null;

function envelope(type, ordinal, payload) {
  return JSON.stringify({ type, timestamp: '2026-09-23T12:00:00.000Z', ordinal, payload });
}

function removeDatabase(databasePath) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

test('bounded attribution backfill keeps usage and monitor state intact across chunked conflicting turn contexts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-attribution-backfill-'));
  const rollout = path.join(directory, 'rollout.jsonl');
  const databasePath = path.join(__dirname, `../../data/rollout-attribution-backfill-${randomUUID()}.test.sqlite`);
  removeDatabase(databasePath);
  try {
    const baseline = [
      envelope('session_meta', 0, { cwd: 'C:\\project\\tracker', session_id: 'session_1' }),
      envelope('token_usage_record', 1, {
        thread_id: 'task_1', session_id: 'session_1', turn_id: 'turn_1', response_id: 'response_1',
        usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 },
      }),
    ];
    fs.writeFileSync(rollout, baseline.join('\n'));
    const ingested = ingestRolloutFile({ filePath: rollout, projects, registeredProjectForPath: resolveProject, databasePath });
    assert.equal(ingested.persisted, 1);

    const database = openDatabase(databasePath);
    try {
      persistMonitorCycleStatus(database, {
        completedAt: '2026-09-23T12:01:00.000Z', durationMs: 1, sourcesFound: 1, ignoredSources: 0,
        incompleteAttributionSources: 0, discoveryErrors: 0, failures: 0, persisted: 1, duplicatesIgnored: 0,
        sourceHealth: { caught_up: 1, partial: 0, unavailable: 0 }, stalledSources: 0, pendingBytes: 0, backlogState: 'caught_up',
      });
    } finally { closeDatabase(database); }

    const padding = Array.from({ length: 600 }, (_, index) => envelope('event_msg', index + 3, { content: 'x'.repeat(1_000) }));
    const contexts = [
      envelope('turn_context', 2, { turn_id: 'turn_1', model: 'gpt-5.6-terra', effort: 'medium' }),
      ...padding.slice(0, 80),
      envelope('turn_context', 83, { turn_id: 'turn_1', model: 'gpt-6-astra', effort: 'high' }),
      ...padding.slice(80),
    ];
    fs.appendFileSync(rollout, `\n${contexts.join('\n')}`);

    const snapshot = () => {
      const db = openDatabase(databasePath);
      try {
        return {
          turns: listRolloutTurns(db), checkpoint: getRolloutCheckpoint(db, 'tracker', ingested.sourceFileId),
          health: getLatestRolloutHealth(db, 'tracker'), cycle: getLatestMonitorCycleStatus(db),
        };
      } finally { closeDatabase(db); }
    };
    const before = snapshot();
    const metadata = { project, sourceFileId: ingested.sourceFileId };
    const first = backfillRolloutAttributionFile({ filePath: rollout, metadata, databasePath, maxBytesPerFile: 512 * 1024 });
    const after = snapshot();
    const db = openDatabase(databasePath);
    let readiness;
    try { readiness = getRolloutOverview(db, { registeredProjects: projects }).projects[0].attributionReadiness; } finally { closeDatabase(db); }
    const replay = backfillRolloutAttributionFile({ filePath: rollout, metadata, databasePath, maxBytesPerFile: 512 * 1024 });

    assert.ok(fs.statSync(rollout).size > 512 * 1024);
    assert.ok(first.bytesRead > CHUNK_BYTES);
    assert.ok(first.bytesRead <= 512 * 1024);
    assert.equal(first.bounded, first.bytesRead >= 512 * 1024);
    assert.ok(first.attributionCandidates >= 1);
    assert.equal(readiness.runtimeModel.conflicting, 1);
    assert.equal(readiness.reasoningEffort.conflicting, 1);
    assert.equal(replay.persisted, 0);
    assert.deepEqual(after.turns, before.turns);
    assert.deepEqual(after.checkpoint, before.checkpoint);
    assert.deepEqual(after.health, before.health);
    assert.deepEqual(after.cycle, before.cycle);
    assert.ok(CHUNK_BYTES < first.bytesRead);
  } finally {
    removeDatabase(databasePath);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
