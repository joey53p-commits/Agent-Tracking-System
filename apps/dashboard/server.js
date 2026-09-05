const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { closeDatabase, createAgentProfile, defaultDatabasePath, getAgentPerformance, getSummary, listAgentProfiles, listEvents, openDatabase, recordEvent } = require('../storage/database');
const { getFilterCatalog } = require('./catalog');
const { normalizeEvent } = require('../collector/collect');

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

function readJsonRequest(request, maximumBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maximumBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function saveDashboardEvent(databasePath, candidate) {
  const event = normalizeEvent(candidate);
  const database = openDatabase(databasePath);
  try {
    recordEvent(database, event);
    return event;
  } finally {
    closeDatabase(database);
  }
}

function dashboardData(databasePath, filters) {
  const database = openDatabase(databasePath);
  try {
    const allEvents = listEvents(database);
    const events = listEvents(database, filters);
    return {
      summary: getSummary(database),
      events,
      agents: listAgentProfiles(database),
      agentPerformance: getAgentPerformance(database),
      filters: getFilterCatalog(allEvents),
    };
  } finally {
    closeDatabase(database);
  }
}

function saveAgentProfile(databasePath, candidate) {
  const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
  if (!text(candidate?.displayName, 80) || !text(candidate?.project, 80) || !text(candidate?.role, 80) || !['Codex', 'ChatGPT', 'Other'].includes(candidate?.runtime) || (candidate.defaultModel != null && !text(candidate.defaultModel, 80))) throw new Error('Invalid agent profile.');
  const database = openDatabase(databasePath);
  try { return createAgentProfile(database, { displayName: candidate.displayName.trim(), project: candidate.project.trim(), role: candidate.role.trim(), runtime: candidate.runtime, defaultModel: candidate.defaultModel?.trim() || null }); } finally { closeDatabase(database); }
}

function createDashboardServer({ databasePath = defaultDatabasePath } = {}) {
  return http.createServer(async (request, response) => {
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

    if (request.method === 'POST' && url.pathname === '/api/events') {
      try {
        const event = saveDashboardEvent(databasePath, await readJsonRequest(request));
        return sendJson(response, 201, { event });
      } catch {
        return sendJson(response, 400, { error: 'Unable to record the event. Check required fields and privacy restrictions.' });
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/agents') {
      const database = openDatabase(databasePath);
      try { return sendJson(response, 200, { agents: listAgentProfiles(database, { project: url.searchParams.get('project') || undefined }) }); } finally { closeDatabase(database); }
    }

    if (request.method === 'POST' && url.pathname === '/api/agents') {
      try { return sendJson(response, 201, { agent: saveAgentProfile(databasePath, await readJsonRequest(request)) }); } catch { return sendJson(response, 400, { error: 'Unable to add the agent. Check the required profile fields.' }); }
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

module.exports = { createDashboardServer, dashboardData, saveAgentProfile, saveDashboardEvent, startDashboard };
