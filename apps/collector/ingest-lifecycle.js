const { adaptLifecycleSpool } = require('../../packages/lifecycle-adapter');
const { closeDatabase, defaultDatabasePath, getLifecycleCheckpoint, openDatabase, persistLifecycleBatch } = require('../storage/database');

function ingestLifecycleSpool({ spoolDirectory, projects, databasePath = defaultDatabasePath, dryRun = false, maxFiles, maxFileBytes } = {}) {
  if (!spoolDirectory || !Array.isArray(projects)) throw new Error('Spool directory and registered projects are required');
  const database = openDatabase(databasePath);
  try {
    const checkpoint = getLifecycleCheckpoint(database, 'codex-lifecycle-spool');
    const adapterResult = adaptLifecycleSpool(spoolDirectory, { projects, checkpoint, maxFiles, maxFileBytes });
    if (dryRun) return { persisted: 0, duplicatesIgnored: 0, linkedTurns: 0, ...adapterResult, dryRun: true };
    return { ...persistLifecycleBatch(database, { adapterResult }), health: adapterResult.health, dryRun: false };
  } finally { closeDatabase(database); }
}

function parseArguments(argv) {
  const options = { dryRun: false, spoolDirectory: 'C:\\Users\\jwlin\\.codex\\agent-ops\\hook-events', projectConfigPath: 'C:\\Users\\jwlin\\.codex\\agent-ops\\projects.json' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--spool-dir') options.spoolDirectory = argv[++index];
    if (argv[index] === '--project-config') options.projectConfigPath = argv[++index];
    if (argv[index] === '--dry-run') options.dryRun = true;
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const recorder = require('C:\\Users\\jwlin\\.codex\\agent-ops\\record-hook.js');
  return ingestLifecycleSpool({ spoolDirectory: options.spoolDirectory, projects: recorder.readProjectConfig(options.projectConfigPath), dryRun: options.dryRun });
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { ingestLifecycleSpool, main, parseArguments };
