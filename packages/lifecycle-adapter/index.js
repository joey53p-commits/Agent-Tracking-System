const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { roleForSource } = require('../agent-registry');

const SOURCE_ID = 'codex-lifecycle-spool';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EVENTS = new Set(['SessionStart', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd']);
const STATES = new Set(['started', 'stopped', 'turn_stopped', 'interrupted', 'ended']);
const FORBIDDEN = /^(?:path|cwd|prompt|message|messages|reasoning|tool|command|code|diff|transcript|raw)$/i;

function safeOpaque(value) { return typeof value === 'string' && SAFE_ID.test(value) ? value : null; }
function correlationId(kind, value) {
  if (!safeOpaque(value)) return null;
  return crypto.createHash('sha256').update(`codex-correlation:codex_rollout::${kind}::${value}`).digest('hex');
}
function spoolFileHash(name) {
  return crypto.createHash('sha256').update(`codex-lifecycle-spool-file:${name}`).digest('hex');
}
function assertPrivate(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.test(key)) throw new Error(`Excluded lifecycle field: ${key}`);
    assertPrivate(child);
  }
}
function normalizeLifecycleEvent(value, projects) {
  assertPrivate(value);
  if (!value || value.source !== 'codex-lifecycle-hook' || !EVENTS.has(value.hookEvent) || !STATES.has(value.lifecycleState)) return null;
  const eventId = safeOpaque(value.eventId);
  const project = projects.find((candidate) => candidate.id === value.projectId && candidate.name === value.projectName);
  const sessionId = safeOpaque(value.sourceSessionId);
  if (!eventId || !project || !sessionId || typeof value.recordedAt !== 'string' || Number.isNaN(Date.parse(value.recordedAt))) return null;
  const agent = roleForSource({ agentName: safeOpaque(value.agentType) });
  return {
    eventId, project: { id: project.id, name: project.name }, hookEvent: value.hookEvent, lifecycleState: value.lifecycleState,
    sessionCorrelationId: correlationId('session', sessionId), turnCorrelationId: correlationId('turn', safeOpaque(value.sourceTurnId)),
    agent: { key: agent.key, label: agent.label, population: agent.population, countedInProjectTotals: agent.countedInProjectTotals },
    recordedAt: value.recordedAt,
  };
}
function nextSpoolFiles(names, maxFiles, checkpoint = {}) {
  checkpoint = typeof checkpoint === 'string' ? { lastFileHash: checkpoint } : checkpoint;
  const cursorIndex = checkpoint?.lastFileHash ? names.findIndex((name) => spoolFileHash(name) === checkpoint.lastFileHash) : -1;
  const visited = new Set(checkpoint?.visitedFileHashes || []);
  const ordered = cursorIndex < 0 ? names : [...names.slice(cursorIndex + 1), ...names.slice(0, cursorIndex + 1)];
  const unvisited = ordered.filter((name) => !visited.has(spoolFileHash(name)));
  const selected = unvisited.slice(0, maxFiles);
  return { names: selected, scannedFileHashes: selected.map(spoolFileHash), backlogFiles: unvisited.length - selected.length };
}

function adaptLifecycleSpool(directory, { projects, maxFiles = 128, maxFileBytes = 64 * 1024, checkpoint } = {}) {
  if (!Array.isArray(projects)) throw new Error('Registered projects are required');
  const health = { filesScanned: 0, recordsAccepted: 0, recordsSkipped: 0, malformedRecords: 0, oversizedFiles: 0, backlogFiles: 0, readState: 'caught_up' };
  const events = [];
  const allNames = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  const scan = nextSpoolFiles(allNames, maxFiles, checkpoint);
  const names = scan.names;
  health.backlogFiles = scan.backlogFiles;
  health.readState = health.backlogFiles ? 'partial' : 'caught_up';
  for (const name of names) {
    health.filesScanned += 1;
    const filePath = path.join(directory, name);
    if (fs.statSync(filePath).size > maxFileBytes) { health.oversizedFiles += 1; health.recordsSkipped += 1; continue; }
    try {
      const event = normalizeLifecycleEvent(JSON.parse(fs.readFileSync(filePath, 'utf8')), projects);
      if (!event) { health.recordsSkipped += 1; continue; }
      events.push(event); health.recordsAccepted += 1;
    } catch { health.malformedRecords += 1; }
  }
  return {
    events,
    health,
    checkpoint: {
      sourceId: SOURCE_ID,
      observedFileCount: allNames.length,
      lastFileHash: names.length ? spoolFileHash(names.at(-1)) : checkpoint?.lastFileHash || null,
      scannedFileHashes: scan.scannedFileHashes,
      backlogFileCount: health.backlogFiles,
      isPartial: health.readState === 'partial',
      projectIds: projects.map((project) => project.id),
    },
  };
}

module.exports = { SOURCE_ID, adaptLifecycleSpool, correlationId, nextSpoolFiles, normalizeLifecycleEvent, spoolFileHash };
