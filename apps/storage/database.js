const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');

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
    agent_profile_id TEXT,
    agent_role TEXT,
    runtime TEXT,
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
  CREATE TABLE IF NOT EXISTS agent_profiles (
    agent_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    runtime TEXT NOT NULL,
    default_model TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_assignments (
    assignment_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    project TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(agent_id, project, role)
  );
  CREATE INDEX IF NOT EXISTS agent_assignments_project_idx ON agent_assignments(project, active);
`;

const starterAgents = [
  ['ats-foundation', 'Foundation & Architecture', 'Architecture & delivery', 'gpt-5.6-terra'],
  ['ats-telemetry', 'Telemetry, Privacy & Data Collection', 'Telemetry & privacy', 'gpt-5.6-terra'],
  ['ats-metrics', 'Metrics, Roles & Evaluation', 'Metrics & evaluation', 'gpt-5.6-terra'],
  ['ats-backend', 'Backend, Database & Integrations', 'Backend & integrations', 'gpt-5.6-terra'],
  ['ats-dashboard', 'Dashboard UX & Frontend', 'Dashboard & frontend', 'gpt-5.6-terra'],
  ['ats-qa', 'QA, Security & Pilot Review', 'QA, security & pilot review', 'gpt-5.6-terra'],
  ['ats-explorer', 'Support Explorer', 'Read-only evidence gathering', 'gpt-5.6-luna'],
];

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
  ensureEventColumns(database);
  seedStarterAgents(database);
  return database;
}

function ensureEventColumns(database) {
  const columns = [
    ['agent_profile_id', 'TEXT'],
    ['agent_role', 'TEXT'],
    ['runtime', 'TEXT'],
  ];
  for (const [name, type] of columns) {
    try {
      database.exec(`ALTER TABLE task_events ADD COLUMN ${name} ${type}`);
    } catch (error) {
      if (!String(error.message).includes('duplicate column name')) throw error;
    }
  }
}

function seedStarterAgents(database) {
  const profile = database.prepare(`
    INSERT OR IGNORE INTO agent_profiles (agent_id, display_name, runtime, default_model, active, created_at)
    VALUES (?, ?, 'Codex', ?, 1, ?)
  `);
  const assignment = database.prepare(`
    INSERT OR IGNORE INTO agent_assignments (assignment_id, agent_id, project, role, active)
    VALUES (?, ?, 'Agent Tracking System', ?, 1)
  `);
  const createdAt = new Date().toISOString();
  for (const [agentId, displayName, role, defaultModel] of starterAgents) {
    profile.run(agentId, displayName, defaultModel, createdAt);
    assignment.run(`${agentId}-agent-tracking-system`, agentId, role);
  }
}

function recordEvent(database, event) {
  const statement = database.prepare(`
    INSERT INTO task_events (
      event_id, event_version, recorded_at, task_id, task_title, project, workstream,
      agent, agent_profile_id, agent_role, runtime, model, started_at, completed_at, execution_status, outcome_result,
      retry_count, blocker, validation_json, repository, branch, commit_sha, changed_files_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    event.assignment?.agentId || null,
    event.assignment?.role || null,
    event.execution.runtime || null,
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

function listAgentProfiles(database, { project } = {}) {
  const clauses = ['profiles.active = 1', 'assignments.active = 1'];
  const values = [];
  if (project) {
    clauses.push('assignments.project = ?');
    values.push(project);
  }
  return database.prepare(`
    SELECT profiles.agent_id, profiles.display_name, profiles.runtime, profiles.default_model,
      assignments.project, assignments.role
    FROM agent_profiles profiles
    JOIN agent_assignments assignments ON assignments.agent_id = profiles.agent_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY assignments.project, assignments.role, profiles.display_name
  `).all(...values);
}

function createAgentProfile(database, candidate) {
  const agentId = `agent-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO agent_profiles (agent_id, display_name, runtime, default_model, active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(agentId, candidate.displayName, candidate.runtime, candidate.defaultModel || null, createdAt);
  database.prepare(`
    INSERT INTO agent_assignments (assignment_id, agent_id, project, role, active)
    VALUES (?, ?, ?, ?, 1)
  `).run(`assignment-${randomUUID()}`, agentId, candidate.project, candidate.role);
  return listAgentProfiles(database).find((profile) => profile.agent_id === agentId);
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

function getAgentPerformance(database) {
  const profiles = listAgentProfiles(database);
  const events = listEvents(database);
  return profiles.map((profile) => {
    const assigned = events.filter((event) => event.agent_profile_id === profile.agent_id);
    const completed = assigned.filter((event) => event.execution_status === 'completed');
    const attention = assigned.filter((event) => ['blocked', 'failed', 'waiting_for_approval'].includes(event.execution_status));
    const active = assigned.filter((event) => ['in_progress', 'queued'].includes(event.execution_status));
    const retryTotal = assigned.reduce((total, event) => total + event.retry_count, 0);
    const validated = completed.filter((event) => event.validation.length > 0);
    return {
      ...profile,
      totalTasks: assigned.length,
      completedTasks: completed.length,
      attentionTasks: attention.length,
      activeTasks: active.length,
      failedTasks: assigned.filter((event) => event.execution_status === 'failed').length,
      retryTotal,
      completionRate: assigned.length ? Math.round((completed.length / assigned.length) * 100) : null,
      attentionRate: assigned.length ? Math.round((attention.length / assigned.length) * 100) : null,
      averageRetries: assigned.length ? Number((retryTotal / assigned.length).toFixed(1)) : null,
      validationCoverage: completed.length ? Math.round((validated.length / completed.length) * 100) : null,
      hasEnoughData: assigned.length >= 3,
    };
  });
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

module.exports = { closeDatabase, createAgentProfile, defaultDatabasePath, getAgentPerformance, getSummary, listAgentProfiles, listEvents, openDatabase, recordEvent };
