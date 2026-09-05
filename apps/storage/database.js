const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const repositoryRoot = path.resolve(__dirname, '../..');
const dataDirectory = path.join(repositoryRoot, 'data');
const defaultDatabasePath = path.join(dataDirectory, 'agent-tracking.sqlite');

const schema = `
  CREATE TABLE IF NOT EXISTS task_events (
    event_id TEXT PRIMARY KEY,
    event_version INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_title TEXT NOT NULL,
    project TEXT NOT NULL,
    workstream TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    execution_status TEXT NOT NULL,
    outcome_result TEXT NOT NULL,
    retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
    blocker TEXT,
    validation_json TEXT NOT NULL,
    repository TEXT,
    branch TEXT,
    commit_sha TEXT,
    changed_files_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS task_events_project_workstream_idx ON task_events(project, workstream);
  CREATE INDEX IF NOT EXISTS task_events_status_idx ON task_events(execution_status);
  CREATE INDEX IF NOT EXISTS task_events_recorded_at_idx ON task_events(recorded_at);
`;

function assertDatabaseLocation(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  const resolvedDataDirectory = path.resolve(dataDirectory);
  if (!resolvedPath.startsWith(`${resolvedDataDirectory}${path.sep}`)) {
    throw new Error('Database path must stay inside the local data directory');
  }
  return resolvedPath;
}

function openDatabase(databasePath = defaultDatabasePath) {
  const resolvedPath = assertDatabaseLocation(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(schema);
  return database;
}

function recordEvent(database, event) {
  const statement = database.prepare(`
    INSERT INTO task_events (
      event_id, event_version, recorded_at, task_id, task_title, project, workstream,
      agent, model, started_at, completed_at, execution_status, outcome_result,
      retry_count, blocker, validation_json, repository, branch, commit_sha, changed_files_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  statement.run(
    event.eventId,
    event.eventVersion,
    event.recordedAt,
    event.task.id,
    event.task.title,
    event.task.project,
    event.task.workstream,
    event.execution.agent,
    event.execution.model,
    event.execution.startedAt,
    event.execution.completedAt,
    event.execution.status,
    event.outcome.result,
    event.outcome.retryCount,
    event.outcome.blocker,
    JSON.stringify(event.outcome.validation),
    event.references.repository,
    event.references.branch,
    event.references.commit,
    JSON.stringify(event.references.changedFiles),
  );
  return event.eventId;
}

function listEvents(database, filters = {}) {
  const clauses = [];
  const values = [];
  for (const [column, value] of [['project', filters.project], ['workstream', filters.workstream], ['execution_status', filters.status]]) {
    if (value) {
      clauses.push(`${column} = ?`);
      values.push(value);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database.prepare(`SELECT * FROM task_events ${where} ORDER BY recorded_at DESC`).all(...values);
  return rows.map((row) => ({
    ...row,
    validation: JSON.parse(row.validation_json),
    changedFiles: JSON.parse(row.changed_files_json),
  }));
}

function getSummary(database) {
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS totalTasks,
      SUM(CASE WHEN execution_status = 'completed' THEN 1 ELSE 0 END) AS completedTasks,
      SUM(CASE WHEN execution_status IN ('blocked', 'failed') THEN 1 ELSE 0 END) AS interruptedTasks,
      SUM(retry_count) AS retries
    FROM task_events
  `).get();
  const workstreams = database.prepare(`
    SELECT project, workstream, COUNT(*) AS taskCount,
      SUM(CASE WHEN execution_status = 'completed' THEN 1 ELSE 0 END) AS completedCount
    FROM task_events
    GROUP BY project, workstream
    ORDER BY taskCount DESC, project, workstream
  `).all();
  return { totals: { ...totals, retries: totals.retries || 0 }, workstreams };
}

function closeDatabase(database) {
  database.close();
}

module.exports = { closeDatabase, defaultDatabasePath, getSummary, listEvents, openDatabase, recordEvent };
