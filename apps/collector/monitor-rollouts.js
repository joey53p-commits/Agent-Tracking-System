const fs = require('node:fs');
const path = require('node:path');
const { ingestRolloutFile } = require('./ingest-rollout');
const { rolloutMetadataDiscovery } = require('../../packages/rollout-adapter');
const { closeDatabase, defaultDatabasePath, openDatabase, persistMonitorCycleStatus } = require('../storage/database');

const defaultRolloutDirectory = 'C:\\Users\\jwlin\\.codex\\sessions';
const defaultProjectConfigPath = 'C:\\Users\\jwlin\\.codex\\agent-ops\\projects.json';
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const LOCK_STALE_MS = 30_000;
// A fixed total lets backlogs drain predictably without multiplying work by
// source count. At the default interval this schedules up to 160 MiB in five
// minutes, above the documented 135 MiB baseline while retaining fairness.
const DEFAULT_CATCH_UP_BYTES_PER_CYCLE = 16 * 1024 * 1024;

function lockPathForDatabase(databasePath = defaultDatabasePath) {
  return `${path.resolve(databasePath)}.monitor.lock`;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function acquireDatabaseCycleLock(databasePath = defaultDatabasePath, { now = Date.now(), token = `${process.pid}-${now}-${Math.random()}` } = {}) {
  const lockPath = lockPathForDatabase(databasePath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: now })); } finally { fs.closeSync(descriptor); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {
      // An interrupted creation has no trustworthy owner. Leave a recent file
      // alone, but recover an old corrupt lock without recording its contents.
      try {
        if (now - fs.statSync(lockPath).mtimeMs <= LOCK_STALE_MS) return null;
        fs.rmSync(lockPath);
      } catch { return null; }
      return acquireDatabaseCycleLock(databasePath, { now, token });
    }
    // A slow live cycle must retain its lock; only a dead owner is recoverable.
    const stale = !processIsAlive(existing.pid);
    if (!stale) return null;
    try { fs.rmSync(lockPath); } catch { return null; }
    return acquireDatabaseCycleLock(databasePath, { now, token });
  }
  return {
    release() {
      try {
        const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (existing.token === token) fs.rmSync(lockPath);
      } catch { /* A replaced or removed lock is not ours to change. */ }
    },
  };
}

function isRolloutFile(name) {
  return /^rollout-.*\.jsonl$/i.test(name);
}

function walkRolloutFiles(directory, files = [], errors = []) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) {
    errors.push(error);
    return { files, errors };
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkRolloutFiles(filePath, files, errors);
    else if (entry.isFile() && isRolloutFile(entry.name)) files.push(filePath);
  }
  return { files, errors };
}

function fileState(stat) {
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function sameFileState(left, right) {
  return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
}

function discoverRolloutSources({ rolloutDirectory = defaultRolloutDirectory, projects, registeredProjectForPath, metadataForFile = rolloutMetadataDiscovery, attributionCache = new Map(), statSync = fs.statSync } = {}) {
  if (!Array.isArray(projects) || typeof registeredProjectForPath !== 'function') throw new Error('Registered projects and a project resolver are required');
  const { files, errors } = walkRolloutFiles(rolloutDirectory);
  const sources = [];
  let ignoredSources = 0;
  let incompleteAttributionSources = 0;
  for (const filePath of files) {
    try {
      const state = fileState(statSync(filePath));
      let outcome = attributionCache.get(filePath);
      if (!outcome || !sameFileState(outcome.fileState, state)) {
        outcome = { ...metadataForFile(filePath, projects, registeredProjectForPath), fileState: state };
        attributionCache.set(filePath, outcome);
      }
      if (outcome.state === 'attributed') sources.push({ filePath, metadata: outcome.metadata });
      else if (outcome.state === 'incomplete') incompleteAttributionSources += 1;
      else ignoredSources += 1;
    } catch (error) {
      // A source without attributable metadata cannot be persisted safely.
      errors.push(error);
    }
  }
  return { sources, ignoredSources, incompleteAttributionSources, discoveryErrors: errors.length };
}

function healthState(health) {
  if (!health) return 'unavailable';
  if (health.readState === 'partial' || health.overlongPending || health.malformedRecords > 0) return 'partial';
  return 'caught_up';
}

function fairByteAllocations(sources, budget, cursor = 0) {
  const total = Math.max(0, Math.floor(Number(budget) || 0));
  if (!sources.length || !total) return [];
  const ordered = sources.map((_, index) => sources[(cursor + index) % sources.length]);
  const base = Math.floor(total / ordered.length);
  let remainder = total % ordered.length;
  return ordered.map((source) => {
    const maxBytes = base + (remainder-- > 0 ? 1 : 0);
    return { source, maxBytes };
  });
}

function consumedCatchUpBytes(result, allocation) {
  // Cycle capacity represents physical bounded reads, not requested capacity.
  // The adapter reports actual bytes read (including bounded overlong scans),
  // so a source that consumes less returns the remainder to this cycle.
  const bytesRead = Number(result.health?.bytesRead);
  return Number.isFinite(bytesRead) && bytesRead >= 0 ? Math.floor(bytesRead) : allocation;
}

function checkpointProgressed(previousOffset, result) {
  const checkpoint = result?.checkpoint;
  const offset = checkpoint?.offset;
  if (!Number.isInteger(offset) || offset < 0) return false;
  const envelope = checkpoint.openEnvelope;
  const validEnvelope = envelope && Number.isInteger(envelope.startOffset) && Number.isInteger(envelope.scanOffset)
    && Number.isInteger(envelope.depth) && envelope.startOffset >= offset && envelope.scanOffset >= envelope.startOffset
    && envelope.scanOffset <= checkpoint.fileSize && envelope.depth >= 1 && typeof envelope.inString === 'boolean' && typeof envelope.escaping === 'boolean';
  if (previousOffset === undefined) return offset > 0 || Boolean(validEnvelope && envelope.scanOffset > envelope.startOffset);
  if (offset > previousOffset.offset) return true;
  const previous = previousOffset.openEnvelope;
  const validPrevious = previous && Number.isInteger(previous.startOffset) && Number.isInteger(previous.scanOffset)
    && previous.startOffset >= previousOffset.offset && previous.scanOffset >= previous.startOffset;
  return Boolean(validEnvelope && validPrevious && offset === previousOffset.offset
    && envelope.startOffset === previous.startOffset && envelope.scanOffset > previous.scanOffset);
}

async function runMonitorCycle({ projects, registeredProjectForPath, rolloutDirectory, databasePath = defaultDatabasePath, discoverSources = discoverRolloutSources, ingestFile = ingestRolloutFile, agent, maxBytes, catchUpBytes = DEFAULT_CATCH_UP_BYTES_PER_CYCLE, attributionCache, sourceCursor = 0 } = {}) {
  const lock = acquireDatabaseCycleLock(databasePath);
  if (!lock) return { skipped: true, reason: 'database-cycle-locked' };
  const startedAt = Date.now();
  try {
    const discovery = discoverSources({ rolloutDirectory, projects, registeredProjectForPath, attributionCache });
    const summary = {
      sourcesFound: discovery.sources.length,
      ignoredSources: discovery.ignoredSources,
      incompleteAttributionSources: discovery.incompleteAttributionSources || 0,
      discoveryErrors: discovery.discoveryErrors,
      persisted: 0,
      duplicatesIgnored: 0,
      sourceHealth: { caught_up: 0, partial: 0, unavailable: discovery.discoveryErrors },
      failures: discovery.discoveryErrors,
      pendingBytes: 0,
      stalledSources: 0,
      backlogState: 'caught_up',
      completedAt: null,
      durationMs: 0,
    };
    const budget = Math.max(0, Math.floor(maxBytes || catchUpBytes));
    const orderedSources = fairByteAllocations(discovery.sources, budget, sourceCursor).map(({ source }) => source);
    let pending = [...orderedSources];
    // A source can be retried in this cycle and can have more than one file
    // discovery path over time. Status aggregates must use its final safe
    // observation, keyed by the opaque in-memory source identity.
    const finalSourceHealth = new Map();
    const checkpointOffsets = new Map();
    const stalledSourceIds = new Set();
    const progressedSourceIds = new Set();
    let remainingBytes = budget;
    // A round gives each eligible source an equal bounded chance. Sources
    // still partial re-enter later rounds; caught-up sources release their
    // unused allocation immediately, making the cycle work-conserving.
    while (pending.length && remainingBytes > 0) {
      const nextPending = [];
      // Keep the first opportunity genuinely fair: all sources in a round are
      // allocated from the same round budget. Only after that round do unused
      // caught-up shares flow to the still-partial sources.
      for (const { source, maxBytes: sourceMaxBytes } of fairByteAllocations(pending, remainingBytes, 0)) {
        try {
          const result = await ingestFile({ filePath: source.filePath, metadata: source.metadata, projects, registeredProjectForPath, databasePath, agent, maxBytes: sourceMaxBytes });
          summary.persisted += result.persisted || 0;
          summary.duplicatesIgnored += result.duplicatesIgnored || 0;
          finalSourceHealth.set(source.metadata.sourceFileId, result.health);
          if (result.readFailure) summary.failures += 1;
          remainingBytes -= consumedCatchUpBytes(result, sourceMaxBytes);
          const previousOffset = checkpointOffsets.get(source.filePath);
          const progressed = checkpointProgressed(previousOffset, result);
          if (progressed) progressedSourceIds.add(source.metadata.sourceFileId);
          if (Number.isInteger(result?.checkpoint?.offset)) checkpointOffsets.set(source.filePath, result.checkpoint);
          // Only a safely advanced checkpoint can return in the same cycle.
          // This avoids spinning on malformed or overlong records that are
          // partial but cannot make progress within their bounded read.
          if (result.health?.readState === 'partial' && Number(result.health?.pendingBytes) > 0 && progressed && remainingBytes > 0) nextPending.push(source);
          else if (result.health?.readState === 'partial' && Number(result.health?.pendingBytes) > 0 && !progressed) stalledSourceIds.add(source.metadata.sourceFileId);
        } catch {
          // A previously attributed source may disappear or become unreadable between discovery and ingestion.
          summary.failures += 1;
          finalSourceHealth.set(source.metadata.sourceFileId, null);
          remainingBytes -= sourceMaxBytes;
        }
      }
      pending = nextPending;
    }
    for (const health of finalSourceHealth.values()) {
      const state = healthState(health);
      summary.sourceHealth[state] += 1;
      summary.pendingBytes += Math.max(0, Number(health?.pendingBytes) || 0);
    }
    summary.stalledSources = [...stalledSourceIds].filter((sourceFileId) => !progressedSourceIds.has(sourceFileId)).length;
    summary.completedAt = new Date().toISOString();
    summary.durationMs = Date.now() - startedAt;
    summary.backlogState = summary.incompleteAttributionSources > 0 ? 'incomplete_discovery'
      : summary.sourceHealth.partial > 0 ? 'catching_up'
        : summary.sourceHealth.unavailable > 0 || summary.failures > 0 ? 'unavailable' : 'caught_up';
    const database = openDatabase(databasePath);
    try { persistMonitorCycleStatus(database, summary); } finally { closeDatabase(database); }
    return summary;
  } finally {
    lock.release();
  }
}

function createRolloutMonitor(options = {}) {
  const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, Number(options.intervalMs) || DEFAULT_POLL_INTERVAL_MS);
  let timer = null;
  let activeCycle = null;
  let stopped = false;
  let latest = null;
  const attributionCache = options.attributionCache || new Map();
  let sourceCursor = 0;

  async function runCycle() {
    if (activeCycle) return { skipped: true, reason: 'cycle-already-running' };
    activeCycle = runMonitorCycle({ ...options, attributionCache, sourceCursor }).then((summary) => {
      latest = summary;
      sourceCursor = summary.sourcesFound ? (sourceCursor + 1) % summary.sourcesFound : 0;
      return summary;
    }).finally(() => { activeCycle = null; });
    return activeCycle;
  }

  function start() {
    if (timer) return activeCycle || Promise.resolve(latest);
    stopped = false;
    const initial = runCycle();
    timer = setInterval(() => { if (!stopped) void runCycle(); }, intervalMs);
    return initial;
  }

  async function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (activeCycle) await activeCycle;
  }

  return { intervalMs, get latest() { return latest; }, get running() { return Boolean(activeCycle); }, runCycle, start, stop };
}

function installShutdownHandlers(monitor, processRef = process) {
  let shutdownPromise = null;
  const shutdown = () => {
    if (!shutdownPromise) shutdownPromise = Promise.resolve(monitor.stop()).then(() => { processRef.exitCode = 0; });
    return shutdownPromise;
  };
  processRef.once('SIGINT', shutdown);
  processRef.once('SIGTERM', shutdown);
  return { shutdown };
}

function parseArguments(argv) {
  const options = { mode: null, intervalMs: DEFAULT_POLL_INTERVAL_MS, rolloutDirectory: defaultRolloutDirectory, projectConfigPath: defaultProjectConfigPath };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--once' || argv[index] === '--continuous') {
      const mode = argv[index] === '--once' ? 'once' : 'continuous';
      if (options.mode && options.mode !== mode) throw new Error('Choose exactly one monitor mode: --once or --continuous.');
      options.mode = mode;
    }
    if (argv[index] === '--interval-ms') options.intervalMs = Number(argv[++index]);
    if (argv[index] === '--rollout-dir') options.rolloutDirectory = argv[++index];
    if (argv[index] === '--project-config') options.projectConfigPath = argv[++index];
    if (argv[index] === '--database') options.databasePath = argv[++index];
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) throw new Error('The polling interval must be a positive number of milliseconds');
  if (!options.mode) throw new Error('Choose an explicit monitor mode: --once or --continuous.');
  return options;
}

async function main(argv = process.argv.slice(2), {
  loadObserver = () => require('C:\\Users\\jwlin\\.codex\\agent-ops\\record-hook.js'),
  createMonitor = createRolloutMonitor,
  installHandlers = installShutdownHandlers,
} = {}) {
  const parsed = parseArguments(argv);
  const observer = loadObserver();
  const options = { ...parsed, projects: observer.readProjectConfig(parsed.projectConfigPath), registeredProjectForPath: observer.registeredProjectForPath };
  const monitor = createMonitor(options);
  if (parsed.mode === 'once') return monitor.runCycle();
  installHandlers(monitor);
  return monitor.start();
}

if (require.main === module) {
  main().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

module.exports = { DEFAULT_CATCH_UP_BYTES_PER_CYCLE, DEFAULT_POLL_INTERVAL_MS, LOCK_STALE_MS, MIN_POLL_INTERVAL_MS, acquireDatabaseCycleLock, checkpointProgressed, consumedCatchUpBytes, createRolloutMonitor, defaultProjectConfigPath, defaultRolloutDirectory, discoverRolloutSources, fairByteAllocations, healthState, installShutdownHandlers, isRolloutFile, lockPathForDatabase, main, parseArguments, runMonitorCycle, walkRolloutFiles };
