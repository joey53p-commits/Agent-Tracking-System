const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { DEFAULT_CATCH_UP_BYTES_PER_CYCLE, acquireDatabaseCycleLock, checkpointProgressed, createRolloutMonitor, discoverRolloutSources, fairByteAllocations, installShutdownHandlers, lockPathForDatabase, runMonitorCycle } = require('./monitor-rollouts');
const { closeDatabase, defaultDatabasePath, getLatestMonitorCycleStatus, listRolloutTurns, openDatabase } = require('../storage/database');

const projects = [{ id: 'tracker', name: 'Agent Tracking System', paths: ['C:\\project\\tracker'] }];
const resolveProject = (cwd, registered) => registered.find((project) => project.paths.includes(cwd)) || null;

function rollout(cwd, sessionId, responseId = 'response_1', extra = '') {
  return `${JSON.stringify({ type: 'session_meta', timestamp: '2026-09-15T12:00:00.000Z', ordinal: 0, payload: { cwd, session_id: sessionId } })}\n${JSON.stringify({ type: 'token_usage_record', timestamp: '2026-09-15T12:00:01.000Z', ordinal: 1, payload: { thread_id: 'task_1', session_id: sessionId, turn_id: 'turn_1', response_id: responseId, usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 } } })}${extra}`;
}

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-monitor-'));
  const databasePath = path.join(__dirname, `../../data/rollout-monitor-${randomUUID()}.test.sqlite`);
  fs.rmSync(databasePath, { force: true });
  const cleanup = () => {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  };
  try {
    const result = run({ directory, databasePath });
    return result && typeof result.then === 'function' ? result.finally(cleanup) : (cleanup(), result);
  } catch (error) { cleanup(); throw error; }
}

test('discovers and ingests a rollout attributable to a registered project', async () => fixture(async ({ directory, databasePath }) => {
  fs.mkdirSync(path.join(directory, '2026', '09'), { recursive: true });
  fs.writeFileSync(path.join(directory, '2026', '09', 'rollout-registered.jsonl'), rollout('C:\\project\\tracker', 'registered_session'));
  const result = await runMonitorCycle({ rolloutDirectory: directory, projects, registeredProjectForPath: resolveProject, databasePath });
  const database = openDatabase(databasePath);
  assert.equal(result.sourcesFound, 1);
  assert.equal(result.persisted, 1);
  assert.equal(listRolloutTurns(database).length, 1);
  closeDatabase(database);
}));

test('ignores a rollout from an unregistered project', () => fixture(({ directory, databasePath }) => {
  fs.writeFileSync(path.join(directory, 'rollout-unregistered.jsonl'), rollout('C:\\project\\other', 'other_session'));
  const result = discoverRolloutSources({ rolloutDirectory: directory, projects, registeredProjectForPath: resolveProject });
  assert.equal(result.sources.length, 0);
  assert.equal(result.ignoredSources, 1);
  assert.equal(fs.existsSync(databasePath), false);
}));

test('discovery reuses stable attribution and invalidates it after a source changes', () => fixture(({ directory }) => {
  const filePath = path.join(directory, 'rollout-cache.jsonl');
  fs.writeFileSync(filePath, rollout('C:\\project\\tracker', 'cache_session'));
  const cache = new Map();
  let calls = 0;
  const metadataForFile = () => { calls += 1; return { state: 'attributed', metadata: { project: projects[0], sourceFileId: 'cache' } }; };
  const options = { rolloutDirectory: directory, projects, registeredProjectForPath: resolveProject, attributionCache: cache, metadataForFile };
  assert.equal(discoverRolloutSources(options).sources.length, 1);
  assert.equal(discoverRolloutSources(options).sources.length, 1);
  assert.equal(calls, 1);
  fs.appendFileSync(filePath, '\n');
  assert.equal(discoverRolloutSources(options).sources.length, 1);
  assert.equal(calls, 2);
}));

test('a bounded metadata scan is counted as incomplete discovery, not ignored', () => fixture(({ directory }) => {
  fs.writeFileSync(path.join(directory, 'rollout-unresolved.jsonl'), `{"type":"event_msg","payload":{"content":"${'x'.repeat(256)}"}}`);
  const result = discoverRolloutSources({
    rolloutDirectory: directory, projects, registeredProjectForPath: resolveProject,
    metadataForFile: () => ({ state: 'incomplete', metadata: null }),
  });
  assert.equal(result.ignoredSources, 0);
  assert.equal(result.incompleteAttributionSources, 1);
  assert.equal(result.sources.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /unresolved\.jsonl|content/);
}));

test('catch-up allocation is bounded, fair, and rotates the remainder priority', () => {
  const sources = ['a', 'b', 'c'].map((filePath) => ({ filePath, metadata: {} }));
  const first = fairByteAllocations(sources, 10, 0);
  const second = fairByteAllocations(sources, 10, 1);
  assert.equal(first.reduce((total, item) => total + item.maxBytes, 0), 10);
  assert.deepEqual(first.map((item) => item.maxBytes), [4, 3, 3]);
  assert.deepEqual(second.map((item) => item.source.filePath), ['b', 'c', 'a']);
  assert.ok(DEFAULT_CATCH_UP_BYTES_PER_CYCLE >= 135 * 1024 * 1024 / 10);
});

test('a monitor cycle gives every eligible source a bounded fair share of the catch-up budget', async () => fixture(async ({ databasePath }) => {
  const sources = ['a', 'b', 'c'].map((filePath) => ({ filePath, metadata: { project: projects[0], sourceFileId: filePath } }));
  const allocations = [];
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject, catchUpBytes: 10,
    discoverSources: () => ({ sources, ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
    ingestFile: ({ maxBytes }) => { allocations.push(maxBytes); return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial' } }; },
  });
  assert.deepEqual(allocations, [4, 3, 3]);
  assert.equal(allocations.reduce((total, bytes) => total + bytes, 0), 10);
  assert.equal(result.sourceHealth.partial, 3);
}));

test('caught-up sources release unused shares to an uneven partial backlog in the same cycle', async () => fixture(async ({ databasePath }) => {
  const sources = ['caught-a', 'caught-b', 'backlog'].map((filePath) => ({ filePath, metadata: { project: projects[0], sourceFileId: filePath } }));
  const partialAllocations = [];
  let offset = 0;
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject, catchUpBytes: 10,
    discoverSources: () => ({ sources, ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
    ingestFile: ({ filePath, maxBytes }) => {
      if (filePath === 'backlog') {
        partialAllocations.push(maxBytes);
        offset += maxBytes;
        return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: maxBytes, pendingBytes: 1 }, checkpoint: { offset } };
      }
      return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'caught_up', bytesRead: 0 } };
    },
  });
  assert.equal(partialAllocations.reduce((total, bytes) => total + bytes, 0), 10);
}));

test('a partial source without safe checkpoint progress releases capacity without retrying in the same cycle', async () => fixture(async ({ databasePath }) => {
  const sources = ['stalled', 'backlog'].map((filePath) => ({ filePath, metadata: { project: projects[0], sourceFileId: filePath } }));
  const calls = { stalled: 0, backlog: 0 };
  let backlogOffset = 0;
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject, catchUpBytes: 10,
    discoverSources: () => ({ sources, ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
    ingestFile: ({ filePath, maxBytes }) => {
      calls[filePath] += 1;
      if (filePath === 'stalled') return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: 0, pendingBytes: 99, overlongPending: true }, checkpoint: { offset: 0 } };
      backlogOffset += maxBytes;
      return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: maxBytes, pendingBytes: 99 }, checkpoint: { offset: backlogOffset } };
    },
  });
  assert.equal(calls.stalled, 1);
  assert.equal(calls.backlog, 2);
  assert.equal(backlogOffset, 10);
  assert.equal(result.stalledSources, 1);
}));

test('a valid continuation scan advances monitor progress without being counted stalled', async () => fixture(async ({ databasePath }) => {
  const source = { filePath: 'continued', metadata: { project: projects[0], sourceFileId: 'continued-source' } };
  let calls = 0;
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject, catchUpBytes: 10,
    discoverSources: () => ({ sources: [source], ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
    ingestFile: ({ maxBytes }) => {
      calls += 1;
      const scanOffset = calls === 1 ? 5 : 10;
      return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: 5, pendingBytes: 90, overlongPending: true }, checkpoint: { offset: 0, fileSize: 100, openEnvelope: { startOffset: 0, scanOffset, depth: 1, inString: true, escaping: false } } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.stalledSources, 0);
  assert.equal(checkpointProgressed({ offset: 0, fileSize: 100, openEnvelope: { startOffset: 0, scanOffset: 5, depth: 1, inString: true, escaping: false } }, { checkpoint: { offset: 0, fileSize: 100, openEnvelope: { startOffset: 1, scanOffset: 10, depth: 1, inString: true, escaping: false } } }), false);
}));

test('repeated no-progress observations of one safe source count as one stalled source', async () => fixture(async ({ databasePath }) => {
  const sources = ['duplicate-a', 'duplicate-b'].map((filePath) => ({ filePath, metadata: { project: projects[0], sourceFileId: 'one-safe-source' } }));
  let calls = 0;
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject, catchUpBytes: 10,
    discoverSources: () => ({ sources, ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
    ingestFile: () => { calls += 1; return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: 0, pendingBytes: 20 }, checkpoint: { offset: 0 } }; },
  });
  assert.equal(calls, 2);
  assert.equal(result.sourceHealth.partial, 1);
  assert.equal(result.stalledSources, 1);
}));

test('a source with earlier valid progress is not stalled after a no-progress retry', async () => fixture(async ({ databasePath }) => {
  const source = { filePath: 'progress-then-stop', metadata: { project: projects[0], sourceFileId: 'progressed-source' } };
  let calls = 0;
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject, catchUpBytes: 10,
    discoverSources: () => ({ sources: [source], ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
    ingestFile: () => {
      calls += 1;
      return calls === 1
        ? { persisted: 1, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: 5, pendingBytes: 20 }, checkpoint: { offset: 5 } }
        : { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: 0, pendingBytes: 20 }, checkpoint: { offset: 5 } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.sourceHealth.partial, 1);
  assert.equal(result.stalledSources, 0);
}));

test('cycle pending bytes use a requeued source final observation rather than cumulative attempts', async () => fixture(async ({ databasePath }) => {
  const source = { filePath: 'backlog', metadata: { project: projects[0], sourceFileId: 'same-safe-source' } };
  let calls = 0;
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject, catchUpBytes: 10,
    discoverSources: () => ({ sources: [source], ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
    ingestFile: ({ maxBytes }) => {
      calls += 1;
      return calls === 1
        ? { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: 4, pendingBytes: 90 }, checkpoint: { offset: 4 } }
        : { persisted: 0, duplicatesIgnored: 0, health: { readState: 'partial', bytesRead: maxBytes, pendingBytes: 40 }, checkpoint: { offset: 10 } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.pendingBytes, 40);
  assert.equal(result.sourceHealth.partial, 1);
}));

test('a 135 MiB uneven fixed backlog is schedulable within ten default monitor cycles', async () => fixture(async ({ databasePath }) => {
  const sources = Array.from({ length: 45 }, (_, index) => ({ filePath: `source-${index}`, metadata: { project: projects[0], sourceFileId: `source-${index}` } }));
  let pendingBytes = 135 * 1024 * 1024;
  let offset = 0;
  for (let cycle = 0; cycle < 10 && pendingBytes > 0; cycle += 1) {
    await runMonitorCycle({
      databasePath, projects, registeredProjectForPath: resolveProject,
      discoverSources: () => ({ sources, ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
      ingestFile: ({ filePath, maxBytes }) => {
        if (filePath !== 'source-44') return { persisted: 0, duplicatesIgnored: 0, health: { readState: 'caught_up', bytesRead: 0 } };
        const bytesRead = Math.min(maxBytes, pendingBytes);
        pendingBytes -= bytesRead;
        offset += bytesRead;
        return { persisted: 0, duplicatesIgnored: 0, health: { readState: pendingBytes ? 'partial' : 'caught_up', bytesRead, pendingBytes }, checkpoint: { offset } };
      },
    });
  }
  assert.equal(pendingBytes, 0);
}));

test('an unreadable discovery location is surfaced as unavailable source health without aborting a cycle', async () => fixture(async ({ directory, databasePath }) => {
  const missingDirectory = path.join(directory, 'missing');
  const result = await runMonitorCycle({ rolloutDirectory: missingDirectory, projects, registeredProjectForPath: resolveProject, databasePath });
  assert.equal(result.discoveryErrors, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.sourceHealth.unavailable, 1);
  assert.ok(result.completedAt);
}));

test('a completed cycle persists only safe aggregate operational status, including incomplete discovery', async () => fixture(async ({ databasePath }) => {
  const result = await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject,
    discoverSources: () => ({ sources: [], ignoredSources: 3, incompleteAttributionSources: 2, discoveryErrors: 1 }),
  });
  const database = openDatabase(databasePath);
  try {
    const status = getLatestMonitorCycleStatus(database);
    assert.equal(status.completedAt, result.completedAt);
    assert.equal(status.incompleteAttributionSources, 2);
    assert.equal(status.backlogState, 'incomplete_discovery');
    assert.doesNotMatch(JSON.stringify(status), /"(?:path|rawError|sessionId|turnId|responseId|sourceFileId|checkpoint|prompt|toolData)"/i);
  } finally { closeDatabase(database); }
}));

test('an isolated monitor test cycle does not modify the default local tracker database', async () => fixture(async ({ databasePath }) => {
  const before = fs.statSync(defaultDatabasePath);
  await runMonitorCycle({
    databasePath, projects, registeredProjectForPath: resolveProject,
    discoverSources: () => ({ sources: [], ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0 }),
  });
  const after = fs.statSync(defaultDatabasePath);
  assert.deepEqual({ size: after.size, mtimeMs: after.mtimeMs }, { size: before.size, mtimeMs: before.mtimeMs });
}));

test('repeated cycles reuse checkpoints and response ID deduplication', async () => fixture(async ({ directory, databasePath }) => {
  fs.writeFileSync(path.join(directory, 'rollout-repeat.jsonl'), rollout('C:\\project\\tracker', 'repeat_session'));
  const options = { rolloutDirectory: directory, projects, registeredProjectForPath: resolveProject, databasePath };
  const first = await runMonitorCycle(options);
  const second = await runMonitorCycle(options);
  const database = openDatabase(databasePath);
  assert.equal(first.persisted, 1);
  assert.equal(second.persisted, 0);
  assert.equal(listRolloutTurns(database).length, 1);
  closeDatabase(database);
}));

test('a malformed registered source records partial health and does not stop a healthy source', async () => fixture(async ({ directory, databasePath }) => {
  fs.writeFileSync(path.join(directory, 'rollout-healthy.jsonl'), rollout('C:\\project\\tracker', 'healthy_session'));
  fs.writeFileSync(path.join(directory, 'rollout-bad.jsonl'), rollout('C:\\project\\tracker', 'bad_session', 'bad_response', '\n{"type": }'));
  const result = await runMonitorCycle({ rolloutDirectory: directory, projects, registeredProjectForPath: resolveProject, databasePath });
  const database = openDatabase(databasePath);
  try {
    const health = database.prepare('SELECT read_state, malformed_records FROM rollout_source_health WHERE project_id = ? AND read_state = ? ORDER BY health_id DESC LIMIT 1').get('tracker', 'partial');
    assert.equal(result.sourcesFound, 2);
    assert.equal(result.persisted, 2);
    assert.equal(result.sourceHealth.partial, 1);
    assert.equal(listRolloutTurns(database).length, 2);
    assert.equal(health.read_state, 'partial');
    assert.ok(health.malformed_records >= 1);
  } finally { closeDatabase(database); }
}));

test('overlapping monitor cycles are prevented', async () => fixture(async ({ databasePath }) => {
  let resolveIngest;
  const monitor = createRolloutMonitor({
    databasePath, projects, registeredProjectForPath: resolveProject,
    discoverSources: () => ({ sources: [{ filePath: 'safe', metadata: { project: projects[0], sourceFileId: 'safe' } }], ignoredSources: 0, discoveryErrors: 0 }),
    ingestFile: () => new Promise((resolve) => { resolveIngest = resolve; }),
  });
  const first = monitor.runCycle();
  const second = await monitor.runCycle();
  assert.deepEqual(second, { skipped: true, reason: 'cycle-already-running' });
  resolveIngest({ persisted: 0, duplicatesIgnored: 0, health: { readState: 'caught_up' } });
  await first;
  await monitor.stop();
}));

test('two monitor instances cannot enter a write cycle for the same database', async () => fixture(async ({ databasePath }) => {
  let resolveIngest;
  const source = { filePath: 'safe', metadata: { project: projects[0], sourceFileId: 'safe' } };
  const options = {
    databasePath, projects, registeredProjectForPath: resolveProject,
    discoverSources: () => ({ sources: [source], ignoredSources: 0, discoveryErrors: 0 }),
  };
  const firstMonitor = createRolloutMonitor({ ...options, ingestFile: () => new Promise((resolve) => { resolveIngest = resolve; }) });
  const secondMonitor = createRolloutMonitor({ ...options, ingestFile: () => { throw new Error('second monitor must not ingest'); } });
  const first = firstMonitor.runCycle();
  const second = await secondMonitor.runCycle();
  assert.deepEqual(second, { skipped: true, reason: 'database-cycle-locked' });
  resolveIngest({ persisted: 0, duplicatesIgnored: 0, health: { readState: 'caught_up' } });
  await first;
  await firstMonitor.stop();
  await secondMonitor.stop();
}));

test('a stale dead-process database lock is recovered without exposing lock contents', () => fixture(({ databasePath }) => {
  const lockPath = lockPathForDatabase(databasePath);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, token: 'dead', createdAt: 0 }));
  const lock = acquireDatabaseCycleLock(databasePath);
  assert.ok(lock);
  lock.release();
  assert.equal(fs.existsSync(lockPath), false);
}));

test('an old lock owned by a live process is never stolen', () => fixture(({ databasePath }) => {
  const lockPath = lockPathForDatabase(databasePath);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: 'live', createdAt: 0 }));
  const old = new Date(0);
  fs.utimesSync(lockPath, old, old);
  assert.equal(acquireDatabaseCycleLock(databasePath), null);
  fs.rmSync(lockPath);
}));

test('monitor shutdown clears scheduled polling and waits for its active cycle', async () => fixture(async ({ databasePath }) => {
  let calls = 0;
  const monitor = createRolloutMonitor({
    intervalMs: 1_000, databasePath, projects, registeredProjectForPath: resolveProject,
    discoverSources: () => ({ sources: [], ignoredSources: 0, discoveryErrors: 0 }),
    ingestFile: () => { calls += 1; },
  });
  await monitor.start();
  await monitor.stop();
  assert.equal(monitor.running, false);
  assert.equal(calls, 0);
}));

test('shutdown handlers are installed before startup and await an active initial cycle', async () => fixture(async ({ databasePath }) => {
  const handlers = {};
  const fakeProcess = { exitCode: undefined, once: (signal, handler) => { handlers[signal] = handler; } };
  let resolveIngest;
  const monitor = createRolloutMonitor({
    databasePath, projects, registeredProjectForPath: resolveProject,
    discoverSources: () => ({ sources: [{ filePath: 'safe', metadata: { project: projects[0], sourceFileId: 'safe' } }], ignoredSources: 0, discoveryErrors: 0 }),
    ingestFile: () => new Promise((resolve) => { resolveIngest = resolve; }),
  });
  installShutdownHandlers(monitor, fakeProcess);
  const initial = monitor.start();
  const shutdown = handlers.SIGINT();
  resolveIngest({ persisted: 0, duplicatesIgnored: 0, health: { readState: 'caught_up' } });
  await shutdown;
  await initial;
  assert.equal(fakeProcess.exitCode, 0);
  assert.equal(monitor.running, false);
}));
