const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { closeDatabase, openDatabase, recordEvent } = require('../storage/database');
const { createDashboardServer } = require('./server');

const testDatabasePath = path.join(__dirname, '../../data/dashboard.test.sqlite');

function request(server, pathname) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    }).on('error', reject);
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
  const overview = await request(server, '/api/overview?project=Rise');
  const databaseFile = await request(server, '/data/dashboard.test.sqlite');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  assert.equal(overview.statusCode, 200);
  assert.equal(JSON.parse(overview.body).summary.totals.totalTasks, 1);
  assert.equal(databaseFile.statusCode, 404);
  fs.rmSync(testDatabasePath, { force: true });
  fs.rmSync(`${testDatabasePath}-wal`, { force: true });
  fs.rmSync(`${testDatabasePath}-shm`, { force: true });
});
