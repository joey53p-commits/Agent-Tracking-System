const fs = require('node:fs');
const { adaptRolloutFile } = require('../../packages/rollout-adapter');
const { closeDatabase, defaultDatabasePath, openDatabase, persistRolloutAttributionBackfill } = require('../storage/database');
const { defaultRolloutDirectory, defaultProjectConfigPath, discoverRolloutSources } = require('./monitor-rollouts');

const DEFAULT_MAX_BYTES_PER_FILE = 512 * 1024;
const CHUNK_BYTES = 64 * 1024;

function mergeTurnAttributions(target, additions) {
  for (const value of additions || []) {
    const current = target.get(value.turnId);
    if (!current) { target.set(value.turnId, value); continue; }
    const merge = (field, state) => {
      if (current[state] === 'conflicting' || value[state] === 'conflicting') return { value: null, state: 'conflicting' };
      if (current[state] === 'unavailable') return { value: value[field], state: value[state] };
      if (value[state] === 'unavailable' || current[field] === value[field]) return { value: current[field], state: current[state] };
      return { value: null, state: 'conflicting' };
    };
    const model = merge('model', 'modelState'); const effort = merge('effort', 'effortState');
    target.set(value.turnId, { turnId: value.turnId, model: model.value, modelState: model.state, effort: effort.value, effortState: effort.state });
  }
}

function backfillRolloutAttributionFile({ filePath, metadata, databasePath = defaultDatabasePath, maxBytesPerFile = DEFAULT_MAX_BYTES_PER_FILE } = {}) {
  if (!filePath || !metadata?.project) throw new Error('An attributed rollout source is required');
  const budget = Math.max(0, Math.floor(maxBytesPerFile));
  const values = new Map(); let checkpoint; let read = 0;
  while (read < budget) {
    const result = adaptRolloutFile(filePath, { checkpoint, maxBytes: Math.min(CHUNK_BYTES, budget - read) });
    mergeTurnAttributions(values, result.turnAttributions);
    read += result.health.bytesRead;
    if (result.health.readState === 'caught_up' || !result.health.bytesRead || result.nextCheckpoint.offset === checkpoint?.offset) break;
    checkpoint = result.nextCheckpoint;
  }
  const database = openDatabase(databasePath);
  try {
    const stored = persistRolloutAttributionBackfill(database, { project: metadata.project, turnAttributions: [...values.values()] });
    return { persisted: stored.persisted, duplicatesIgnored: stored.duplicatesIgnored, bytesRead: read, bounded: read >= budget, attributionCandidates: values.size };
  } finally { closeDatabase(database); }
}

function backfillRolloutAttribution({ sources = [], databasePath = defaultDatabasePath, maxBytesPerFile = DEFAULT_MAX_BYTES_PER_FILE } = {}) {
  const summary = { sources: 0, persisted: 0, duplicatesIgnored: 0, bytesRead: 0, boundedSources: 0, failures: 0 };
  for (const source of sources) {
    try {
      const result = backfillRolloutAttributionFile({ ...source, databasePath, maxBytesPerFile });
      summary.sources += 1; summary.persisted += result.persisted; summary.duplicatesIgnored += result.duplicatesIgnored; summary.bytesRead += result.bytesRead;
      if (result.bounded) summary.boundedSources += 1;
    } catch { summary.failures += 1; }
  }
  return summary;
}

function parseArguments(argv) {
  const options = { rolloutDirectory: defaultRolloutDirectory, projectConfigPath: defaultProjectConfigPath, maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--rollout-dir') options.rolloutDirectory = argv[++index];
    if (argv[index] === '--project-config') options.projectConfigPath = argv[++index];
    if (argv[index] === '--database') options.databasePath = argv[++index];
    if (argv[index] === '--max-bytes-per-file') options.maxBytesPerFile = Number(argv[++index]);
  }
  if (!Number.isInteger(options.maxBytesPerFile) || options.maxBytesPerFile <= 0) throw new Error('max-bytes-per-file must be a positive integer');
  return options;
}

function main(argv = process.argv.slice(2), { loadObserver = () => require('C:\\Users\\jwlin\\.codex\\agent-ops\\record-hook.js') } = {}) {
  const options = parseArguments(argv); const observer = loadObserver();
  const projects = observer.readProjectConfig(options.projectConfigPath);
  const discovery = discoverRolloutSources({ rolloutDirectory: options.rolloutDirectory, projects, registeredProjectForPath: observer.registeredProjectForPath });
  return { ...backfillRolloutAttribution({ sources: discovery.sources, databasePath: options.databasePath, maxBytesPerFile: options.maxBytesPerFile }), ignoredSources: discovery.ignoredSources, incompleteAttributionSources: discovery.incompleteAttributionSources, discoveryErrors: discovery.discoveryErrors };
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { CHUNK_BYTES, DEFAULT_MAX_BYTES_PER_FILE, backfillRolloutAttribution, backfillRolloutAttributionFile, main, mergeTurnAttributions, parseArguments };
