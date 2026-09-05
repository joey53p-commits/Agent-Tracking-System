const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateTaskEvent } = require('../../packages/event-schema');
const { assertSafeEvent } = require('./privacy');
const { closeDatabase, defaultDatabasePath, openDatabase, recordEvent } = require('../storage/database');

function normalizeEvent(candidate, now = new Date().toISOString()) {
  assertSafeEvent(candidate);
  const event = {
    eventVersion: 1,
    eventId: candidate.eventId || randomUUID(),
    recordedAt: candidate.recordedAt || now,
    task: { id: candidate.task?.id, title: candidate.task?.title, project: candidate.task?.project, workstream: candidate.task?.workstream },
    assignment: { agentId: candidate.assignment?.agentId || null, role: candidate.assignment?.role || null },
    execution: { agent: candidate.execution?.agent, runtime: candidate.execution?.runtime || null, model: candidate.execution?.model || null, startedAt: candidate.execution?.startedAt, completedAt: candidate.execution?.completedAt || null, status: candidate.execution?.status },
    outcome: { result: candidate.outcome?.result || 'unknown', retryCount: candidate.outcome?.retryCount ?? 0, blocker: candidate.outcome?.blocker || null, validation: candidate.outcome?.validation || [] },
    references: { repository: candidate.references?.repository || null, branch: candidate.references?.branch || null, commit: candidate.references?.commit || null, changedFiles: candidate.references?.changedFiles || [] },
  };
  const validation = validateTaskEvent(event);
  if (!validation.valid) throw new Error(`Invalid task event: ${validation.errors.join(', ')}`);
  return event;
}

function storeEvent(event, databasePath = defaultDatabasePath) {
  const database = openDatabase(databasePath);
  try {
    recordEvent(database, event);
    return databasePath;
  } finally {
    closeDatabase(database);
  }
}

function parseArguments(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    if (argv[index] === '--dry-run') options.dryRun = true;
  }
  if (!options.input) throw new Error('Usage: node apps/collector/collect.js --input path/to/event.json [--dry-run]');
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const candidate = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'));
  const event = normalizeEvent(candidate);
  return { event, databasePath: options.dryRun ? null : storeEvent(event) };
}

if (require.main === module) {
  try {
    const { event, databasePath } = main();
    process.stdout.write(`${databasePath ? `Recorded ${event.eventId} in ${databasePath}` : JSON.stringify(event, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, normalizeEvent, storeEvent };
