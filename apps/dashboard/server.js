const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { closeDatabase, defaultDatabasePath, getSummary, listEvents, openDatabase } = require('../storage/database');

const publicDirectory = path.join(__dirname, 'public');
const staticFiles = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', contentType: 'text/css; charset=utf-8' },
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function dashboardData(databasePath, filters) {
  const database = openDatabase(databasePath);
  try {
    const allEvents = listEvents(database);
    const events = listEvents(database, filters);
    return {
      summary: getSummary(database),
      events,
      filters: {
        projects: [...new Set(allEvents.map((event) => event.project))].sort(),
        workstreams: [...new Set(allEvents.map((event) => event.workstream))].sort(),
        statuses: [...new Set(allEvents.map((event) => event.execution_status))].sort(),
      },
    };
  } finally {
    closeDatabase(database);
  }
}

function createDashboardServer({ databasePath = defaultDatabasePath } = {}) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/api/overview') {
      try {
        return sendJson(response, 200, dashboardData(databasePath, {
          project: url.searchParams.get('project') || undefined,
          workstream: url.searchParams.get('workstream') || undefined,
          status: url.searchParams.get('status') || undefined,
        }));
      } catch (error) {
        return sendJson(response, 500, { error: 'Unable to load local dashboard data.' });
      }
    }

    const asset = request.method === 'GET' ? staticFiles[url.pathname] : null;
    if (!asset) return sendJson(response, 404, { error: 'Not found' });
    response.writeHead(200, { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(publicDirectory, asset.file)).pipe(response);
  });
}

function startDashboard({ port = Number(process.env.PORT || 4173), databasePath } = {}) {
  const server = createDashboardServer({ databasePath });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Agent Tracking dashboard is available at http://127.0.0.1:${port}\n`);
  });
  return server;
}

if (require.main === module) startDashboard();

module.exports = { createDashboardServer, dashboardData, startDashboard };
