const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { closeDatabase, openDatabase, persistMonitorCycleStatus, persistRolloutBatch, recordEvent } = require('../storage/database');
const { createDashboardServer, startDashboard } = require('./server');

const testDatabasePath = path.join(__dirname, '../../data/dashboard.test.sqlite');

function request(server, { method = 'GET', pathname, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function removeDatabase(databasePath) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

function git(directory, arguments_) {
  return execFileSync('git', ['-C', directory, ...arguments_], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createGitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tracking-dashboard-api-'));
  const repositoryPath = path.join(root, 'work');
  const remotePath = path.join(root, 'remote.git');
  fs.mkdirSync(repositoryPath);
  git(repositoryPath, ['init']);
  git(repositoryPath, ['config', 'user.name', 'Dashboard fixture']);
  git(repositoryPath, ['config', 'user.email', 'dashboard@example.invalid']);
  fs.writeFileSync(path.join(repositoryPath, 'tracked.txt'), 'fixture\n');
  git(repositoryPath, ['add', 'tracked.txt']);
  git(repositoryPath, ['commit', '-m', 'fixture']);
  execFileSync('git', ['init', '--bare', remotePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(repositoryPath, ['remote', 'add', 'origin', remotePath]);
  git(repositoryPath, ['push', '--set-upstream', 'origin', 'HEAD']);
  return { root, repositoryPath };
}

function persistRolloutFixture(databasePath, {
  freshnessState = 'fresh',
  readState = 'caught_up',
  pendingBytes = 0,
  includeTurn = true,
  sourceFileId = 'opaque-source-hash',
  now = '2026-09-15T12:00:00.000Z',
  agent = { key: 'unknown', label: 'Unknown role', population: 'project_agent', countedInProjectTotals: true },
  additionalTurns = [],
} = {}) {
  const database = openDatabase(databasePath);
  try {
    persistRolloutBatch(database, {
      project: { id: 'tracker', name: 'Agent Tracking System' },
      sourceFileId,
      now,
      adapterResult: {
        turns: includeTurn ? [{
          taskId: 'codex_rollout::task::task_1', sessionId: 'codex_rollout::session::session_1', turnId: 'codex_rollout::turn::turn_1', responseId: 'codex_rollout::response::response_1',
          usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 },
          agent,
        }, ...additionalTurns] : [],
        health: { filesScanned: 1, bytesRead: 200, recordsScanned: 2, recordsAccepted: includeTurn ? 1 + additionalTurns.length : 0, recordsSkipped: includeTurn ? Math.max(0, 1 - additionalTurns.length) : 2, malformedRecords: 0, recordsWithoutUsableUsage: 0, overlongRecords: 0, overlongPending: readState === 'partial', schemaObservations: ['token_usage_record:response_usage_v1'], freshness: { ageMs: 0, state: freshnessState }, pendingBytes, readState },
        nextCheckpoint: { offset: 200, fileSize: 200 },
      },
    });
  } finally { closeDatabase(database); }
}

function privateFieldPresent(value) {
  const forbidden = /^(?:prompt|message|messages|reasoning|tool|toolData|command|code|diff|transcript|raw|path|cwd|sessionId|threadId|turnId|responseId|sourceFileId|source|schemaObservations|checkpoint)$/i;
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => forbidden.test(key) || privateFieldPresent(child));
}

function persistMonitorStatus(databasePath, overrides = {}) {
  const database = openDatabase(databasePath);
  try {
    persistMonitorCycleStatus(database, {
      completedAt: '2026-09-15T12:05:00.000Z', durationMs: 32, sourcesFound: 2, ignoredSources: 1,
      incompleteAttributionSources: 0, discoveryErrors: 0, failures: 0, persisted: 1, duplicatesIgnored: 0,
      sourceHealth: { caught_up: 1, partial: 1, unavailable: 0 }, stalledSources: 0, pendingBytes: 19, backlogState: 'catching_up', ...overrides,
    });
  } finally { closeDatabase(database); }
}

test('serves a local dashboard summary without exposing a database file', async () => {
  fs.rmSync(testDatabasePath, { force: true });
  const database = openDatabase(testDatabasePath);
  recordEvent(database, {
    eventVersion: 1,
    eventId: 'dashboard-event',
    recordedAt: '2026-09-05T20:00:00.000Z',
    task: { id: 'rise-300', title: 'Review onboarding', project: 'Rise', workstream: 'quality' },
    execution: { agent: 'Codex', model: null, startedAt: '2026-09-05T19:00:00.000Z', completedAt: null, status: 'completed' },
    outcome: { result: 'accepted', retryCount: 0, blocker: null, validation: ['test passed'] },
    references: { repository: 'rise-redesign', branch: 'main', commit: null, changedFiles: ['App.js'] },
  });
  closeDatabase(database);

  const server = createDashboardServer({ databasePath: testDatabasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const overview = await request(server, { pathname: '/api/overview?project=Rise' });
  const databaseFile = await request(server, { pathname: '/data/dashboard.test.sqlite' });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  assert.equal(overview.statusCode, 200);
  const overviewData = JSON.parse(overview.body);
  assert.equal(overviewData.summary.totals.totalTasks, 1);
  assert.equal(overviewData.filters.projects.includes('Rise'), true);
  assert.equal(overviewData.filters.workstreams.includes('Quality Assurance'), true);
  assert.equal(overviewData.filters.statuses.includes('waiting_for_approval'), true);
  assert.equal(Array.isArray(overviewData.agentPerformance), true);
  assert.equal(databaseFile.statusCode, 404);
  fs.rmSync(testDatabasePath, { force: true });
  fs.rmSync(`${testDatabasePath}-wal`, { force: true });
  fs.rmSync(`${testDatabasePath}-shm`, { force: true });
});

test('dashboard startup only serves the local API and never schedules or starts a monitor', async () => {
  const databasePath = path.join(__dirname, `../../data/dashboard-read-only-${randomUUID()}.test.sqlite`);
  const lockPath = `${path.resolve(databasePath)}.monitor.lock`;
  removeDatabase(databasePath);
  fs.rmSync(lockPath, { force: true });
  const originalSetInterval = global.setInterval;
  let scheduledIntervals = 0;
  global.setInterval = (...args) => { scheduledIntervals += 1; return originalSetInterval(...args); };
  let server;
  try {
    server = startDashboard({ port: 0, databasePath, registeredProjects: [] });
    await new Promise((resolve) => server.once('listening', resolve));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(scheduledIntervals, 0);
    assert.equal(fs.existsSync(databasePath), false);
    assert.equal(fs.existsSync(lockPath), false);
    const overview = await request(server, { pathname: '/api/rollout-overview' });
    assert.equal(overview.statusCode, 200);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    global.setInterval = originalSetInterval;
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    removeDatabase(databasePath);
    fs.rmSync(lockPath, { force: true });
  }
});

test('project overview exposes only safe derived local Git activity from an isolated local repository fixture', async () => {
  const databasePath = path.join(__dirname, `../../data/project-overview-${randomUUID()}.test.sqlite`);
  const fixture = createGitFixture();
  removeDatabase(databasePath);
  let server;
  try {
    server = createDashboardServer({ databasePath, registeredProjects: [{ id: 'fixture', name: 'Fixture project', paths: [fixture.repositoryPath] }] });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await request(server, { pathname: '/api/project-overview' });
    const data = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.match(data.observedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(data.projects.length, 1);
    assert.equal(data.projects[0].project.name, 'Fixture project');
    assert.equal(data.projects[0].localFiles.state, 'clean');
    assert.equal(data.projects[0].commit.state, 'available');
    assert.equal(data.projects[0].remoteRelationship.evidence, 'local_git_knowledge');
    assert.equal(privateFieldPresent(data), false);
    assert.equal(JSON.stringify(data).includes(fixture.repositoryPath), false);
  } finally {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    removeDatabase(databasePath);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('records safe dashboard submissions and rejects private task content', async () => {
  fs.rmSync(testDatabasePath, { force: true });
  const server = createDashboardServer({ databasePath: testDatabasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const safeEvent = {
    task: { id: 'rise-301', title: 'Verify plan screen', project: 'Rise', workstream: 'Quality Assurance' },
    execution: { agent: 'Codex', model: 'gpt-5.6-sol', startedAt: '2026-09-05T20:00:00.000Z', status: 'completed' },
    outcome: { result: 'accepted', retryCount: 0, validation: ['manual smoke test completed'] },
    references: { repository: 'rise-redesign', branch: 'main', changedFiles: ['App.js'] },
  };
  const recorded = await request(server, { method: 'POST', pathname: '/api/events', body: safeEvent });
  const rejected = await request(server, { method: 'POST', pathname: '/api/events', body: { ...safeEvent, task: { ...safeEvent.task, prompt: 'private content' } } });
  const overview = await request(server, { pathname: '/api/overview' });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  assert.equal(recorded.statusCode, 201);
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.parse(overview.body).summary.totals.totalTasks, 1);
  fs.rmSync(testDatabasePath, { force: true });
  fs.rmSync(`${testDatabasePath}-wal`, { force: true });
  fs.rmSync(`${testDatabasePath}-shm`, { force: true });
});

test('serves seeded delivery-team profiles and accepts a project role assignment', async () => {
  fs.rmSync(testDatabasePath, { force: true });
  const server = createDashboardServer({ databasePath: testDatabasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const seeded = await request(server, { pathname: '/api/agents?project=Agent%20Tracking%20System' });
  const created = await request(server, { method: 'POST', pathname: '/api/agents', body: { displayName: 'Rise Data Reviewer', project: 'Rise', role: 'Data review', runtime: 'Codex', defaultModel: 'GPT-5.6 Sol' } });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const seededAgents = JSON.parse(seeded.body).agents;
  assert.equal(seededAgents.some((agent) => agent.agent_id === 'ats-telemetry' && agent.default_model === 'gpt-5.6-terra'), true);
  assert.equal(seededAgents.some((agent) => agent.agent_id === 'ats-explorer' && agent.default_model === 'gpt-5.6-luna'), true);
  assert.equal(created.statusCode, 201);
  assert.equal(JSON.parse(created.body).agent.role, 'Data review');
  fs.rmSync(testDatabasePath, { force: true });
  fs.rmSync(`${testDatabasePath}-wal`, { force: true });
  fs.rmSync(`${testDatabasePath}-shm`, { force: true });
});

test('rollout overview returns only persisted, allowlisted response usage data', async () => {
  const databasePath = path.join(__dirname, `../../data/rollout-overview-${randomUUID()}.test.sqlite`);
  removeDatabase(databasePath);
  persistRolloutFixture(databasePath);
  const server = createDashboardServer({ databasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const overview = await request(server, { pathname: '/api/rollout-overview' });
  const rawRows = await request(server, { pathname: '/api/rollouts' });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const data = JSON.parse(overview.body);
  assert.equal(overview.statusCode, 200);
  assert.equal(data.hasRolloutRecords, true);
  assert.deepEqual(data.projects[0].project, { name: 'Agent Tracking System' });
  assert.equal(data.projects[0].totals.activeTasks, 1);
  assert.equal(data.projects[0].totals.completedTasks, 0);
  assert.deepEqual(data.projects[0].totals.exactResponseUsage, { inputTokens: 11, outputTokens: 4, totalTokens: 15 });
  assert.deepEqual(data.projects[0].tasks[0], { taskId: 'codex_rollout::task::task_1', state: 'active_incomplete', turnCount: 1, exactTokenTotal: 15, roleLabel: 'Unknown role' });
  assert.deepEqual(data.projects[0].roles, [{ roleLabel: 'Unknown role', turnCount: 1, exactTokenTotal: 15 }]);
  assert.equal(privateFieldPresent(data), false);
  assert.equal(rawRows.statusCode, 404);
  removeDatabase(databasePath);
});

test('rollout overview lists registered projects before their first ingestion and displays latest source health safely', async () => {
  const emptyPath = path.join(__dirname, `../../data/rollout-empty-${randomUUID()}.test.sqlite`);
  removeDatabase(emptyPath);
  const emptyServer = createDashboardServer({ databasePath: emptyPath, registeredProjects: [{ id: 'tracker', name: 'Agent Tracking System' }] });
  await new Promise((resolve) => emptyServer.listen(0, '127.0.0.1', resolve));
  const empty = JSON.parse((await request(emptyServer, { pathname: '/api/rollout-overview' })).body);
  await new Promise((resolve, reject) => emptyServer.close((error) => error ? reject(error) : resolve()));
  assert.deepEqual(empty, { hasRolloutRecords: false, monitorCycle: null, projects: [{ project: { name: 'Agent Tracking System' }, sourceHealth: null, totals: { activeTasks: 0, completedTasks: 0, exactResponseUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }, tasks: [], roles: [] }] });
  removeDatabase(emptyPath);

  const healthPath = path.join(__dirname, `../../data/rollout-health-${randomUUID()}.test.sqlite`);
  removeDatabase(healthPath);
  persistRolloutFixture(healthPath, { freshnessState: 'stale', readState: 'partial', pendingBytes: 19 });
  const healthServer = createDashboardServer({ databasePath: healthPath });
  await new Promise((resolve) => healthServer.listen(0, '127.0.0.1', resolve));
  const health = JSON.parse((await request(healthServer, { pathname: '/api/rollout-overview' })).body).projects[0].sourceHealth;
  await new Promise((resolve, reject) => healthServer.close((error) => error ? reject(error) : resolve()));
  assert.deepEqual(health, { latestIngestionAt: '2026-09-15T12:00:00.000Z', freshnessState: 'stale', readState: 'partial', pendingBytes: 19 });
  removeDatabase(healthPath);
});

test('rollout overview returns only allowlisted aggregate monitor-cycle status', async () => {
  const databasePath = path.join(__dirname, `../../data/monitor-status-${randomUUID()}.test.sqlite`);
  removeDatabase(databasePath);
  persistMonitorStatus(databasePath, { incompleteAttributionSources: 2, discoveryErrors: 1, failures: 1, backlogState: 'incomplete_discovery' });
  const server = createDashboardServer({ databasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const data = JSON.parse((await request(server, { pathname: '/api/rollout-overview' })).body);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.deepEqual(data.monitorCycle, { completedAt: '2026-09-15T12:05:00.000Z', durationMs: 32, sourcesFound: 2, ignoredSources: 1, incompleteAttributionSources: 2, discoveryErrors: 1, failures: 1, persisted: 1, duplicatesIgnored: 0, caughtUpSources: 1, partialSources: 1, unavailableSources: 0, stalledSources: 0, pendingBytes: 19, backlogState: 'incomplete_discovery' });
  assert.equal(privateFieldPresent(data.monitorCycle), false);
  removeDatabase(databasePath);
});

test('rollout overview aggregates the latest health of every source without masking partial backlog', async () => {
  const databasePath = path.join(__dirname, `../../data/rollout-health-aggregate-${randomUUID()}.test.sqlite`);
  removeDatabase(databasePath);
  persistRolloutFixture(databasePath, { sourceFileId: 'source-partial', freshnessState: 'stale', readState: 'partial', pendingBytes: 19, now: '2026-09-15T12:00:00.000Z' });
  persistRolloutFixture(databasePath, { sourceFileId: 'source-healthy', freshnessState: 'fresh', readState: 'caught_up', pendingBytes: 0, now: '2026-09-15T12:01:00.000Z' });
  const server = createDashboardServer({ databasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const health = JSON.parse((await request(server, { pathname: '/api/rollout-overview' })).body).projects[0].sourceHealth;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.deepEqual(health, { latestIngestionAt: '2026-09-15T12:01:00.000Z', freshnessState: 'stale', readState: 'partial', pendingBytes: 19 });
  removeDatabase(databasePath);
});

test('rollout overview treats a source-health-only ingestion as a real safe record', async () => {
  const databasePath = path.join(__dirname, `../../data/rollout-health-only-${randomUUID()}.test.sqlite`);
  removeDatabase(databasePath);
  persistRolloutFixture(databasePath, { includeTurn: false });
  const server = createDashboardServer({ databasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = await request(server, { pathname: '/api/rollout-overview' });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const data = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(data.hasRolloutRecords, true);
  assert.equal(data.projects.length, 1);
  assert.deepEqual(data.projects[0].tasks, []);
  assert.deepEqual(data.projects[0].roles, []);
  assert.equal(data.projects[0].sourceHealth.latestIngestionAt, '2026-09-15T12:00:00.000Z');
  assert.equal(privateFieldPresent(data), false);
  removeDatabase(databasePath);
});

test('rollout overview excludes system-guardian tasks from project-agent activity totals', async () => {
  const databasePath = path.join(__dirname, `../../data/rollout-guardian-${randomUUID()}.test.sqlite`);
  removeDatabase(databasePath);
  persistRolloutFixture(databasePath, {
    agent: { key: 'unknown', label: 'Unknown role', population: 'system_guardian', countedInProjectTotals: false },
  });
  const server = createDashboardServer({ databasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = await request(server, { pathname: '/api/rollout-overview' });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const data = JSON.parse(response.body);
  assert.equal(data.hasRolloutRecords, true);
  assert.deepEqual(data.projects[0].totals, {
    activeTasks: 0,
    completedTasks: 0,
    exactResponseUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
  assert.deepEqual(data.projects[0].tasks, []);
  assert.deepEqual(data.projects[0].roles, []);
  assert.equal(privateFieldPresent(data), false);
  removeDatabase(databasePath);
});

test('rollout overview excludes guardian turns from a mixed task turn count and usage', async () => {
  const databasePath = path.join(__dirname, `../../data/rollout-mixed-${randomUUID()}.test.sqlite`);
  removeDatabase(databasePath);
  persistRolloutFixture(databasePath, {
    additionalTurns: [{
      taskId: 'codex_rollout::task::task_1',
      sessionId: 'codex_rollout::session::session_1',
      turnId: 'codex_rollout::turn::guardian_turn',
      responseId: 'codex_rollout::response::guardian_response',
      usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      agent: { key: 'unknown', label: 'Unknown role', population: 'system_guardian', countedInProjectTotals: false },
    }],
  });
  const server = createDashboardServer({ databasePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = await request(server, { pathname: '/api/rollout-overview' });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const data = JSON.parse(response.body);
  assert.equal(data.projects[0].totals.activeTasks, 1);
  assert.deepEqual(data.projects[0].totals.exactResponseUsage, { inputTokens: 11, outputTokens: 4, totalTokens: 15 });
  assert.deepEqual(data.projects[0].tasks[0], {
    taskId: 'codex_rollout::task::task_1',
    state: 'active_incomplete',
    turnCount: 1,
    exactTokenTotal: 15,
    roleLabel: 'Unknown role',
  });
  assert.deepEqual(data.projects[0].roles, [{ roleLabel: 'Unknown role', turnCount: 1, exactTokenTotal: 15 }]);
  removeDatabase(databasePath);
});
