const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { closeDatabase, openDatabase, recordEvent } = require('../storage/database');
const { createDashboardServer } = require('./server');

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
  assert.equal(databaseFile.statusCode, 404);
  fs.rmSync(testDatabasePath, { force: true });
  fs.rmSync(`${testDatabasePath}-wal`, { force: true });
  fs.rmSync(`${testDatabasePath}-shm`, { force: true });
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
