const { adaptRolloutFile, rolloutMetadata } = require('../../packages/rollout-adapter');
const { closeDatabase, defaultDatabasePath, getRolloutCheckpoint, openDatabase, persistRolloutBatch } = require('../storage/database');

const defaultObserverPath = 'C:\\Users\\jwlin\\.codex\\agent-ops\\record-hook.js';
const defaultProjectConfigPath = 'C:\\Users\\jwlin\\.codex\\agent-ops\\projects.json';

function failedAdapterResult(_error, checkpoint) {
  return {
    turns: [],
    tasks: [],
    health: {
      filesScanned: 1, bytesRead: 0, recordsScanned: 0, recordsAccepted: 0, recordsSkipped: 0,
      // The health table intentionally stores counters, not error text or paths.
      malformedRecords: 1, recordsWithoutUsableUsage: 0, overlongRecords: 0, overlongPending: true,
      schemaObservations: [], freshness: { ageMs: 0, state: 'stale' }, pendingBytes: 0, readState: 'partial',
    },
    nextCheckpoint: checkpoint || { offset: 0, fileSize: 0 },
    readFailure: true,
  };
}

function ingestRolloutFile({ filePath, projects, registeredProjectForPath, databasePath = defaultDatabasePath, dryRun = false, agent, maxBytes, metadata: suppliedMetadata } = {}) {
  if (!filePath || !Array.isArray(projects) || typeof registeredProjectForPath !== 'function') {
    throw new Error('Rollout file, registered projects, and observer project resolver are required');
  }
  const metadata = suppliedMetadata || rolloutMetadata(filePath, projects, registeredProjectForPath);
  if (!metadata) return { project: null, persisted: 0, duplicatesIgnored: 0, health: null, reason: 'unregistered-project-or-source' };
  const { project, sourceFileId: fileId } = metadata;
  const database = openDatabase(databasePath);
  try {
    const checkpoint = getRolloutCheckpoint(database, project.id, fileId);
    let adapterResult;
    try {
      adapterResult = adaptRolloutFile(filePath, { checkpoint, agent, maxBytes });
      // Keep a safe, durable indication that a malformed source needs attention,
      // even if later complete envelopes were checkpointed successfully.
      if (adapterResult.health.malformedRecords > 0) adapterResult.health.readState = 'partial';
    } catch (error) {
      adapterResult = failedAdapterResult(error, checkpoint && { offset: checkpoint.offset, fileSize: checkpoint.file_size });
    }
    if (dryRun) return { project, sourceFileId: fileId, persisted: 0, duplicatesIgnored: 0, health: adapterResult.health, checkpoint: adapterResult.nextCheckpoint, dryRun: true };
    const result = persistRolloutBatch(database, { project, sourceFileId: fileId, adapterResult });
    return { project, sourceFileId: fileId, ...result, health: adapterResult.health, checkpoint: adapterResult.nextCheckpoint, dryRun: false, readFailure: Boolean(adapterResult.readFailure) };
  } finally {
    closeDatabase(database);
  }
}

function parseArguments(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--rollout') options.filePath = argv[++index];
    if (argv[index] === '--project-config') options.projectConfigPath = argv[++index];
    if (argv[index] === '--dry-run') options.dryRun = true;
  }
  if (!options.filePath) throw new Error('Usage: node apps/collector/ingest-rollout.js --rollout path/to/rollout.jsonl [--dry-run]');
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const observer = require(defaultObserverPath);
  const projects = observer.readProjectConfig(options.projectConfigPath || defaultProjectConfigPath);
  return ingestRolloutFile({ ...options, projects, registeredProjectForPath: observer.registeredProjectForPath });
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { failedAdapterResult, ingestRolloutFile, main, parseArguments };
