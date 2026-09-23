const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const crypto = require('node:crypto');

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
  CREATE TABLE IF NOT EXISTS rollout_tasks (
    task_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
    is_complete INTEGER NOT NULL CHECK (is_complete IN (0, 1)),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
    usage_kind TEXT NOT NULL CHECK (usage_kind = 'response_exact'),
    turn_count INTEGER NOT NULL CHECK (turn_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rollout_tasks_project_idx ON rollout_tasks(project_id, status);
  CREATE TABLE IF NOT EXISTS rollout_turns (
    response_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES rollout_tasks(task_id),
    project_id TEXT NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    role_key TEXT NOT NULL,
    role_label TEXT NOT NULL,
    population TEXT NOT NULL CHECK (population IN ('project_agent', 'system_guardian')),
    counted_in_project_totals INTEGER NOT NULL CHECK (counted_in_project_totals IN (0, 1)),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
    usage_kind TEXT NOT NULL CHECK (usage_kind = 'response_exact'),
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rollout_turns_task_idx ON rollout_turns(task_id);
  CREATE TABLE IF NOT EXISTS rollout_lifecycle_events (
    event_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    hook_event TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    session_correlation_id TEXT NOT NULL,
    turn_correlation_id TEXT,
    role_key TEXT NOT NULL,
    role_label TEXT NOT NULL,
    population TEXT NOT NULL CHECK (population IN ('project_agent', 'system_guardian')),
    counted_in_project_totals INTEGER NOT NULL CHECK (counted_in_project_totals IN (0, 1)),
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rollout_lifecycle_project_session_idx ON rollout_lifecycle_events(project_id, session_correlation_id);
  CREATE TABLE IF NOT EXISTS lifecycle_source_checkpoints (
    project_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    observed_file_count INTEGER NOT NULL,
    last_file_hash TEXT,
    backlog_file_count INTEGER NOT NULL DEFAULT 0,
    is_partial INTEGER NOT NULL DEFAULT 0 CHECK (is_partial IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, source_id)
  );
  CREATE TABLE IF NOT EXISTS lifecycle_scanned_files (
    project_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    PRIMARY KEY (project_id, source_id, file_hash)
  );
  CREATE TABLE IF NOT EXISTS rollout_source_checkpoints (
    project_id TEXT NOT NULL,
    source_file_id TEXT NOT NULL,
    offset INTEGER NOT NULL CHECK (offset >= 0),
    file_size INTEGER NOT NULL CHECK (file_size >= 0),
    open_start_offset INTEGER,
    scan_offset INTEGER,
    scan_depth INTEGER,
    scan_in_string INTEGER,
    scan_escaping INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, source_file_id)
  );
  CREATE TABLE IF NOT EXISTS rollout_source_health (
    health_id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    source_file_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    files_scanned INTEGER NOT NULL,
    bytes_read INTEGER NOT NULL,
    records_scanned INTEGER NOT NULL,
    records_accepted INTEGER NOT NULL,
    records_skipped INTEGER NOT NULL,
    malformed_records INTEGER NOT NULL,
    records_without_usable_usage INTEGER NOT NULL,
    overlong_records INTEGER NOT NULL DEFAULT 0,
    overlong_pending INTEGER NOT NULL DEFAULT 0,
    schema_observations_json TEXT NOT NULL,
    freshness_age_ms INTEGER NOT NULL,
    freshness_state TEXT NOT NULL CHECK (freshness_state IN ('fresh', 'stale')),
    pending_bytes INTEGER NOT NULL DEFAULT 0,
    read_state TEXT NOT NULL DEFAULT 'caught_up' CHECK (read_state IN ('caught_up', 'partial'))
  );
  CREATE INDEX IF NOT EXISTS rollout_source_health_project_idx ON rollout_source_health(project_id, observed_at DESC);
  CREATE TABLE IF NOT EXISTS monitor_cycle_status (
    cycle_id INTEGER PRIMARY KEY,
    completed_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    sources_found INTEGER NOT NULL CHECK (sources_found >= 0),
    ignored_sources INTEGER NOT NULL CHECK (ignored_sources >= 0),
    incomplete_attribution_sources INTEGER NOT NULL CHECK (incomplete_attribution_sources >= 0),
    discovery_errors INTEGER NOT NULL CHECK (discovery_errors >= 0),
    failures INTEGER NOT NULL CHECK (failures >= 0),
    persisted INTEGER NOT NULL CHECK (persisted >= 0),
    duplicates_ignored INTEGER NOT NULL CHECK (duplicates_ignored >= 0),
    caught_up_sources INTEGER NOT NULL CHECK (caught_up_sources >= 0),
    partial_sources INTEGER NOT NULL CHECK (partial_sources >= 0),
    unavailable_sources INTEGER NOT NULL CHECK (unavailable_sources >= 0),
    stalled_sources INTEGER NOT NULL DEFAULT 0 CHECK (stalled_sources >= 0),
    pending_bytes INTEGER NOT NULL CHECK (pending_bytes >= 0),
    backlog_state TEXT NOT NULL CHECK (backlog_state IN ('caught_up', 'catching_up', 'incomplete_discovery', 'unavailable'))
  );
  CREATE INDEX IF NOT EXISTS monitor_cycle_status_completed_idx ON monitor_cycle_status(completed_at DESC);
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
  ensureRolloutColumns(database);
  ensureMonitorCycleColumns(database);
  seedStarterAgents(database);
  return database;
}

function ensureMonitorCycleColumns(database) {
  try { database.exec('ALTER TABLE monitor_cycle_status ADD COLUMN stalled_sources INTEGER NOT NULL DEFAULT 0'); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

function ensureRolloutColumns(database) {
  for (const [name, definition] of [['pending_bytes', 'INTEGER NOT NULL DEFAULT 0'], ['read_state', "TEXT NOT NULL DEFAULT 'caught_up'"], ['overlong_records', 'INTEGER NOT NULL DEFAULT 0'], ['overlong_pending', 'INTEGER NOT NULL DEFAULT 0']]) {
    try { database.exec(`ALTER TABLE rollout_source_health ADD COLUMN ${name} ${definition}`); } catch (error) {
      if (!String(error.message).includes('duplicate column name')) throw error;
    }
  }
  for (const [name, definition] of [['open_start_offset', 'INTEGER'], ['scan_offset', 'INTEGER'], ['scan_depth', 'INTEGER'], ['scan_in_string', 'INTEGER'], ['scan_escaping', 'INTEGER']]) {
    try { database.exec(`ALTER TABLE rollout_source_checkpoints ADD COLUMN ${name} ${definition}`); } catch (error) {
      if (!String(error.message).includes('duplicate column name')) throw error;
    }
  }
  for (const [name, definition] of [['last_file_hash', 'TEXT'], ['backlog_file_count', 'INTEGER NOT NULL DEFAULT 0'], ['is_partial', 'INTEGER NOT NULL DEFAULT 0']]) {
    try { database.exec(`ALTER TABLE lifecycle_source_checkpoints ADD COLUMN ${name} ${definition}`); } catch (error) {
      if (!String(error.message).includes('duplicate column name')) throw error;
    }
  }
  for (const [table, name, definition] of [
    ['rollout_tasks', 'session_correlation_id', 'TEXT'],
    ['rollout_turns', 'session_correlation_id', 'TEXT'],
    ['rollout_turns', 'turn_correlation_id', 'TEXT'],
  ]) {
    try { database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); } catch (error) {
      if (!String(error.message).includes('duplicate column name')) throw error;
    }
  }
  for (const row of database.prepare('SELECT task_id, session_id FROM rollout_tasks WHERE session_correlation_id IS NULL').all()) {
    database.prepare('UPDATE rollout_tasks SET session_correlation_id = ? WHERE task_id = ?').run(correlationId(row.session_id), row.task_id);
  }
  for (const row of database.prepare('SELECT response_id, session_id, turn_id FROM rollout_turns WHERE session_correlation_id IS NULL OR turn_correlation_id IS NULL').all()) {
    database.prepare('UPDATE rollout_turns SET session_correlation_id = ?, turn_correlation_id = ? WHERE response_id = ?').run(correlationId(row.session_id), correlationId(row.turn_id), row.response_id);
  }
}

function correlationId(value) { return crypto.createHash('sha256').update(`codex-correlation:${value}`).digest('hex'); }

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

function getRolloutCheckpoint(database, projectId, sourceFileId) {
  const row = database.prepare(`
    SELECT offset, file_size AS fileSize, open_start_offset AS openStartOffset, scan_offset AS scanOffset,
      scan_depth AS scanDepth, scan_in_string AS scanInString, scan_escaping AS scanEscaping, updated_at AS updatedAt
    FROM rollout_source_checkpoints WHERE project_id = ? AND source_file_id = ?
  `).get(projectId, sourceFileId);
  if (!row) return null;
  return row.openStartOffset == null ? row : {
    ...row,
    openEnvelope: { startOffset: row.openStartOffset, scanOffset: row.scanOffset, depth: row.scanDepth, inString: Boolean(row.scanInString), escaping: Boolean(row.scanEscaping) },
  };
}

function getLifecycleCheckpoint(database, sourceId) {
  const row = database.prepare(`
    SELECT last_file_hash AS lastFileHash, observed_file_count AS observedFileCount,
      backlog_file_count AS backlogFileCount, is_partial AS isPartial, updated_at AS updatedAt
    FROM lifecycle_source_checkpoints WHERE source_id = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(sourceId);
  if (!row) return null;
  return {
    ...row,
    visitedFileHashes: database.prepare('SELECT file_hash AS fileHash FROM lifecycle_scanned_files WHERE source_id = ?').all(sourceId).map((file) => file.fileHash),
  };
}

function listRolloutTasks(database, { projectId } = {}) {
  const rows = projectId
    ? database.prepare('SELECT * FROM rollout_tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
    : database.prepare('SELECT * FROM rollout_tasks ORDER BY updated_at DESC').all();
  return rows.map((row) => ({ ...row, isComplete: Boolean(row.is_complete), usageExact: row.usage_kind === 'response_exact' }));
}

function listRolloutTurns(database, { taskId } = {}) {
  const rows = taskId
    ? database.prepare('SELECT * FROM rollout_turns WHERE task_id = ? ORDER BY recorded_at').all(taskId)
    : database.prepare('SELECT * FROM rollout_turns ORDER BY recorded_at').all();
  return rows.map((row) => ({ ...row, countedInProjectTotals: Boolean(row.counted_in_project_totals), usageExact: row.usage_kind === 'response_exact' }));
}

function getLatestRolloutHealth(database, projectId) {
  const row = database.prepare(`
    WITH latest_per_source AS (
      SELECT source_file_id, MAX(health_id) AS health_id
      FROM rollout_source_health WHERE project_id = ? GROUP BY source_file_id
    )
    SELECT
      MAX(health.observed_at) AS observed_at,
      CASE WHEN SUM(CASE WHEN health.freshness_state = 'stale' THEN 1 ELSE 0 END) > 0 THEN 'stale' ELSE 'fresh' END AS freshness_state,
      CASE WHEN SUM(CASE WHEN health.read_state = 'partial' THEN 1 ELSE 0 END) > 0 THEN 'partial' ELSE 'caught_up' END AS read_state,
      COALESCE(SUM(health.pending_bytes), 0) AS pending_bytes
    FROM rollout_source_health health
    JOIN latest_per_source latest ON latest.health_id = health.health_id
  `).get(projectId);
  return row?.observed_at ? { ...row, schemaObservations: [] } : null;
}

function assertSafeMonitorCycleStatus(summary) {
  const numberFields = ['durationMs', 'sourcesFound', 'ignoredSources', 'incompleteAttributionSources', 'discoveryErrors', 'failures', 'persisted', 'duplicatesIgnored', 'pendingBytes', 'stalledSources'];
  if (!summary || typeof summary.completedAt !== 'string' || !Number.isFinite(Date.parse(summary.completedAt))) throw new Error('A completed monitor cycle timestamp is required');
  for (const field of numberFields) if (!Number.isInteger(summary[field]) || summary[field] < 0) throw new Error('Monitor cycle status must contain safe non-negative counters');
  for (const field of ['caught_up', 'partial', 'unavailable']) if (!Number.isInteger(summary.sourceHealth?.[field]) || summary.sourceHealth[field] < 0) throw new Error('Monitor cycle source health is required');
  if (!['caught_up', 'catching_up', 'incomplete_discovery', 'unavailable'].includes(summary.backlogState)) throw new Error('Monitor cycle backlog state is invalid');
}

function persistMonitorCycleStatus(database, summary) {
  assertSafeMonitorCycleStatus(summary);
  database.prepare(`
    INSERT INTO monitor_cycle_status (
      completed_at, duration_ms, sources_found, ignored_sources, incomplete_attribution_sources,
      discovery_errors, failures, persisted, duplicates_ignored, caught_up_sources, partial_sources,
      unavailable_sources, stalled_sources, pending_bytes, backlog_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    summary.completedAt, summary.durationMs, summary.sourcesFound, summary.ignoredSources, summary.incompleteAttributionSources,
    summary.discoveryErrors, summary.failures, summary.persisted, summary.duplicatesIgnored, summary.sourceHealth.caught_up,
    summary.sourceHealth.partial, summary.sourceHealth.unavailable, summary.stalledSources, summary.pendingBytes, summary.backlogState,
  );
}

function getLatestMonitorCycleStatus(database) {
  const row = database.prepare(`
    SELECT completed_at AS completedAt, duration_ms AS durationMs, sources_found AS sourcesFound,
      ignored_sources AS ignoredSources, incomplete_attribution_sources AS incompleteAttributionSources,
      discovery_errors AS discoveryErrors, failures, persisted, duplicates_ignored AS duplicatesIgnored,
      caught_up_sources AS caughtUpSources, partial_sources AS partialSources,
      unavailable_sources AS unavailableSources, stalled_sources AS stalledSources, pending_bytes AS pendingBytes, backlog_state AS backlogState
    FROM monitor_cycle_status ORDER BY cycle_id DESC LIMIT 1
  `).get();
  return row || null;
}

function getRolloutOverview(database, { registeredProjects = [] } = {}) {
  const persistedProjects = database.prepare(`
    SELECT project_id AS projectId, project_name AS projectName
    FROM (
      SELECT project_id, project_name FROM rollout_tasks
      UNION
      SELECT project_id, project_name FROM rollout_source_health
    )
    ORDER BY project_name, project_id
  `).all();
  // Registered names are safe dashboard metadata. Combining them here lets the
  // read-only view distinguish a configured project that has not been ingested
  // yet from an entirely unconfigured database, without persisting paths.
  const projectsByName = new Map();
  for (const project of registeredProjects) {
    if (typeof project?.id === 'string' && typeof project?.name === 'string') {
      projectsByName.set(project.name, { projectId: project.id, projectName: project.name });
    }
  }
  for (const project of persistedProjects) {
    // A registered ID can be renamed without exposing it in the dashboard.
    // Persisted data for the same safe project name remains the authoritative
    // source for health and usage until a later ingestion uses the new ID.
    projectsByName.set(project.projectName, project);
  }
  const projects = [...projectsByName.values()].sort((left, right) => left.projectName.localeCompare(right.projectName) || left.projectId.localeCompare(right.projectId));

  const taskCounts = database.prepare(`
    SELECT
      COUNT(*) AS totalTasks,
      SUM(CASE WHEN is_complete = 0 THEN 1 ELSE 0 END) AS activeTasks,
      SUM(CASE WHEN is_complete = 1 THEN 1 ELSE 0 END) AS completedTasks
    FROM rollout_tasks tasks
    WHERE project_id = ? AND EXISTS (
      SELECT 1 FROM rollout_turns visible_turn
      WHERE visible_turn.task_id = tasks.task_id
        AND visible_turn.project_id = tasks.project_id
        AND visible_turn.usage_kind = 'response_exact'
        AND visible_turn.counted_in_project_totals = 1
    )
  `);
  const exactUsage = database.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens
    FROM rollout_turns
    WHERE project_id = ? AND usage_kind = 'response_exact' AND counted_in_project_totals = 1
  `);
  const tasks = database.prepare(`
    SELECT
      tasks.task_id AS taskId,
      CASE WHEN tasks.is_complete = 1 THEN 'completed' ELSE 'active_incomplete' END AS state,
      COALESCE(SUM(CASE WHEN turns.usage_kind = 'response_exact' AND turns.counted_in_project_totals = 1 THEN 1 ELSE 0 END), 0) AS turnCount,
      COALESCE(SUM(CASE WHEN turns.usage_kind = 'response_exact' AND turns.counted_in_project_totals = 1 THEN turns.total_tokens ELSE 0 END), 0) AS exactTokenTotal,
      CASE WHEN COUNT(DISTINCT CASE WHEN turns.counted_in_project_totals = 1 THEN turns.role_label END) = 1
        THEN MAX(CASE WHEN turns.counted_in_project_totals = 1 THEN turns.role_label END)
        ELSE 'Unknown role'
      END AS roleLabel
    FROM rollout_tasks tasks
    LEFT JOIN rollout_turns turns ON turns.task_id = tasks.task_id
    WHERE tasks.project_id = ? AND EXISTS (
      SELECT 1 FROM rollout_turns visible_turn
      WHERE visible_turn.task_id = tasks.task_id
        AND visible_turn.project_id = tasks.project_id
        AND visible_turn.usage_kind = 'response_exact'
        AND visible_turn.counted_in_project_totals = 1
    )
    GROUP BY tasks.task_id, tasks.is_complete, tasks.updated_at
    ORDER BY tasks.updated_at DESC, tasks.task_id
  `);
  const roles = database.prepare(`
    SELECT
      role_label AS roleLabel,
      COUNT(*) AS turnCount,
      COALESCE(SUM(total_tokens), 0) AS exactTokenTotal
    FROM rollout_turns
    WHERE project_id = ? AND usage_kind = 'response_exact' AND counted_in_project_totals = 1
    GROUP BY role_label
    ORDER BY exactTokenTotal DESC, role_label
  `);
  const health = database.prepare(`
    WITH latest_per_source AS (
      SELECT source_file_id, MAX(health_id) AS health_id
      FROM rollout_source_health WHERE project_id = ? GROUP BY source_file_id
    )
    SELECT
      MAX(health.observed_at) AS latestIngestionAt,
      CASE WHEN SUM(CASE WHEN health.freshness_state = 'stale' THEN 1 ELSE 0 END) > 0 THEN 'stale' ELSE 'fresh' END AS freshnessState,
      CASE WHEN SUM(CASE WHEN health.read_state = 'partial' THEN 1 ELSE 0 END) > 0 THEN 'partial' ELSE 'caught_up' END AS readState,
      COALESCE(SUM(health.pending_bytes), 0) AS pendingBytes
    FROM rollout_source_health health
    JOIN latest_per_source latest ON latest.health_id = health.health_id
  `);

  const records = projects.map((project) => {
    const counts = taskCounts.get(project.projectId);
    return {
      project: { name: project.projectName },
      sourceHealth: health.get(project.projectId)?.latestIngestionAt ? health.get(project.projectId) : null,
      totals: {
        activeTasks: counts.activeTasks || 0,
        completedTasks: counts.completedTasks || 0,
        exactResponseUsage: exactUsage.get(project.projectId),
      },
      tasks: tasks.all(project.projectId),
      roles: roles.all(project.projectId),
    };
  });
  return { hasRolloutRecords: persistedProjects.length > 0, monitorCycle: getLatestMonitorCycleStatus(database), projects: records };
}

function assertSafeRolloutPayload(payload) {
  const forbidden = /^(?:prompt|message|messages|reasoning|tool|toolData|command|code|diff|transcript|raw|thread_token_usage|turn_token_usage|cwd|path)$/i;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) throw new Error('Rollout payload contains an excluded field');
      visit(child);
    }
  };
  visit(payload);
}

function persistRolloutBatch(database, { project, sourceFileId, adapterResult, now = new Date().toISOString(), failAfterTurns } = {}) {
  if (!project?.id || !project?.name || !sourceFileId || !adapterResult?.health || !adapterResult?.nextCheckpoint) {
    throw new Error('Project, source file ID, adapter result, and checkpoint are required');
  }
  assertSafeRolloutPayload(adapterResult);
  let persisted = 0;
  let duplicatesIgnored = 0;
  database.exec('BEGIN IMMEDIATE');
  try {
    const insertTask = database.prepare(`
      INSERT OR IGNORE INTO rollout_tasks (
        task_id, project_id, project_name, source, session_id, status, is_complete,
        input_tokens, output_tokens, total_tokens, usage_kind, turn_count, created_at, updated_at, session_correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'response_exact', 0, ?, ?, ?)
    `);
    const insertTurn = database.prepare(`
      INSERT OR IGNORE INTO rollout_turns (
        response_id, task_id, project_id, source, session_id, turn_id, role_key, role_label,
        population, counted_in_project_totals, input_tokens, output_tokens, total_tokens, usage_kind, recorded_at, session_correlation_id, turn_correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'response_exact', ?, ?, ?)
    `);
    const updateTask = database.prepare(`
      UPDATE rollout_tasks SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
        total_tokens = total_tokens + ?, turn_count = turn_count + 1, updated_at = ?
      WHERE task_id = ? AND is_complete = 0
    `);
    for (const turn of adapterResult.turns) {
      insertTask.run(turn.taskId, project.id, project.name, 'codex_rollout', turn.sessionId, 'active', 0, now, now, correlationId(turn.sessionId));
      const inserted = insertTurn.run(
        turn.responseId, turn.taskId, project.id, 'codex_rollout', turn.sessionId, turn.turnId,
        turn.agent.key, turn.agent.label, turn.agent.population, turn.agent.countedInProjectTotals ? 1 : 0,
        turn.usage.inputTokens, turn.usage.outputTokens, turn.usage.totalTokens, now, correlationId(turn.sessionId), correlationId(turn.turnId),
      );
      if (inserted.changes === 0) { duplicatesIgnored += 1; continue; }
      if (failAfterTurns === persisted) throw new Error('Injected transaction failure');
      const updated = updateTask.run(turn.usage.inputTokens, turn.usage.outputTokens, turn.usage.totalTokens, now, turn.taskId);
      if (updated.changes === 0) throw new Error('Completed task cannot accept a new turn');
      persisted += 1;
    }
    database.prepare(`
      INSERT INTO rollout_source_health (
        project_id, project_name, source_file_id, observed_at, files_scanned, bytes_read, records_scanned,
        records_accepted, records_skipped, malformed_records, records_without_usable_usage, overlong_records, overlong_pending,
        schema_observations_json, freshness_age_ms, freshness_state, pending_bytes, read_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.name, sourceFileId, now, adapterResult.health.filesScanned, adapterResult.health.bytesRead,
      adapterResult.health.recordsScanned, adapterResult.health.recordsAccepted, adapterResult.health.recordsSkipped,
      adapterResult.health.malformedRecords, adapterResult.health.recordsWithoutUsableUsage,
      adapterResult.health.overlongRecords,
      adapterResult.health.overlongPending ? 1 : 0,
      JSON.stringify(adapterResult.health.schemaObservations), adapterResult.health.freshness.ageMs, adapterResult.health.freshness.state,
      adapterResult.health.pendingBytes, adapterResult.health.readState,
    );
    database.prepare(`
      INSERT INTO rollout_source_checkpoints (project_id, source_file_id, offset, file_size, open_start_offset, scan_offset, scan_depth, scan_in_string, scan_escaping, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_file_id) DO UPDATE SET offset = excluded.offset, file_size = excluded.file_size, open_start_offset = excluded.open_start_offset, scan_offset = excluded.scan_offset, scan_depth = excluded.scan_depth, scan_in_string = excluded.scan_in_string, scan_escaping = excluded.scan_escaping, updated_at = excluded.updated_at
    `).run(project.id, sourceFileId, adapterResult.nextCheckpoint.offset, adapterResult.nextCheckpoint.fileSize,
      adapterResult.nextCheckpoint.openEnvelope?.startOffset ?? null, adapterResult.nextCheckpoint.openEnvelope?.scanOffset ?? null,
      adapterResult.nextCheckpoint.openEnvelope?.depth ?? null, adapterResult.nextCheckpoint.openEnvelope?.inString ? 1 : 0,
      adapterResult.nextCheckpoint.openEnvelope?.escaping ? 1 : 0, now);
    database.exec('COMMIT');
    return { persisted, duplicatesIgnored, checkpointAdvanced: true };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function persistLifecycleBatch(database, { adapterResult, now = new Date().toISOString(), failAfterEvents } = {}) {
  if (!adapterResult?.events || !adapterResult?.health || !adapterResult?.checkpoint) throw new Error('Lifecycle adapter result is required');
  assertSafeRolloutPayload(adapterResult);
  let persisted = 0; let duplicatesIgnored = 0; let linkedTurns = 0;
  database.exec('BEGIN IMMEDIATE');
  try {
    const insert = database.prepare(`INSERT OR IGNORE INTO rollout_lifecycle_events (event_id, project_id, project_name, hook_event, lifecycle_state, session_correlation_id, turn_correlation_id, role_key, role_label, population, counted_in_project_totals, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const link = database.prepare(`UPDATE rollout_turns SET role_key = ?, role_label = ?, population = ?, counted_in_project_totals = ? WHERE project_id = ? AND session_correlation_id = ? AND (? IS NULL OR turn_correlation_id = ?) AND role_key = 'unknown'`);
    for (const event of adapterResult.events) {
      const changed = insert.run(event.eventId, event.project.id, event.project.name, event.hookEvent, event.lifecycleState, event.sessionCorrelationId, event.turnCorrelationId, event.agent.key, event.agent.label, event.agent.population, event.agent.countedInProjectTotals ? 1 : 0, event.recordedAt).changes;
      if (!changed) { duplicatesIgnored += 1; continue; }
      if (failAfterEvents === persisted) throw new Error('Injected lifecycle transaction failure');
      linkedTurns += link.run(event.agent.key, event.agent.label, event.agent.population, event.agent.countedInProjectTotals ? 1 : 0, event.project.id, event.sessionCorrelationId, event.turnCorrelationId, event.turnCorrelationId).changes;
      persisted += 1;
    }
    const projectIds = new Set(adapterResult.checkpoint.projectIds || adapterResult.events.map((event) => event.project.id));
    const checkpoint = database.prepare(`
      INSERT INTO lifecycle_source_checkpoints (project_id, source_id, observed_file_count, last_file_hash, backlog_file_count, is_partial, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_id) DO UPDATE SET observed_file_count = excluded.observed_file_count,
        last_file_hash = excluded.last_file_hash, backlog_file_count = excluded.backlog_file_count,
        is_partial = excluded.is_partial, updated_at = excluded.updated_at
    `);
    for (const projectId of projectIds) checkpoint.run(projectId, adapterResult.checkpoint.sourceId, adapterResult.checkpoint.observedFileCount,
      adapterResult.checkpoint.lastFileHash || null, adapterResult.checkpoint.backlogFileCount || 0,
      adapterResult.checkpoint.isPartial ? 1 : 0, now);
    const scannedFile = database.prepare('INSERT OR IGNORE INTO lifecycle_scanned_files (project_id, source_id, file_hash) VALUES (?, ?, ?)');
    for (const projectId of projectIds) {
      for (const fileHash of adapterResult.checkpoint.scannedFileHashes || []) scannedFile.run(projectId, adapterResult.checkpoint.sourceId, fileHash);
    }
    database.exec('COMMIT'); return { persisted, duplicatesIgnored, linkedTurns, checkpointAdvanced: true };
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

module.exports = { assertSafeMonitorCycleStatus, assertSafeRolloutPayload, closeDatabase, createAgentProfile, defaultDatabasePath, getAgentPerformance, getLatestMonitorCycleStatus, getLatestRolloutHealth, getLifecycleCheckpoint, getRolloutCheckpoint, getRolloutOverview, getSummary, listAgentProfiles, listEvents, listRolloutTasks, listRolloutTurns, openDatabase, persistLifecycleBatch, persistMonitorCycleStatus, persistRolloutBatch, recordEvent };
