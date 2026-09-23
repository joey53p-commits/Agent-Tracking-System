const fs = require('node:fs');
const crypto = require('node:crypto');
const { createRolloutNormalizer } = require('../rollout-normalizer');

const SOURCE = 'codex_rollout';
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_METADATA_MAX_BYTES = 128 * 1024;
const MODEL_ID = /^(?:gpt-\d+(?:\.\d+)?-[a-z0-9][a-z0-9.-]{0,63}|o\d(?:-[a-z0-9.-]{1,63})?)$/i;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function parseJsonObjects(input, baseOffset = 0) {
  // Checkpoints are file byte offsets.  Parse the UTF-8 bytes directly so a
  // non-ASCII character never makes a JavaScript string index look like a
  // filesystem offset.
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  const records = [];
  let malformedRecords = 0;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = 0; index < bytes.length; index += 1) {
    const character = bytes[index];
    if (start < 0) {
      if (character === 123) { start = index; depth = 1; inString = false; escaping = false; }
      continue;
    }
    if (inString) {
      if (escaping) escaping = false;
      else if (character === 92) escaping = true;
      else if (character === 34) inString = false;
      continue;
    }
    if (character === 34) { inString = true; continue; }
    if (character === 123) depth += 1;
    if (character !== 125 || --depth !== 0) continue;
    try {
      records.push({ value: JSON.parse(bytes.subarray(start, index + 1).toString('utf8')), endOffset: baseOffset + index + 1 });
    } catch {
      records.push({ value: null, endOffset: baseOffset + index + 1, malformed: true });
      malformedRecords += 1;
    }
    start = -1;
  }
  return {
    records, malformedRecords, openStartOffset: start < 0 ? null : baseOffset + start,
    openState: start < 0 ? null : { scanOffset: baseOffset + bytes.length, depth, inString, escaping },
  };
}

function findObjectEnd(filePath, startOffset, fileSize, chunkBytes, maximumBytes, state = {}) {
  let depth = Number.isInteger(state.depth) ? state.depth : 0;
  let inString = Boolean(state.inString);
  let escaping = Boolean(state.escaping);
  let position = startOffset;
  let bytesRead = 0;
  while (position < fileSize && bytesRead < maximumBytes) {
    const length = Math.min(chunkBytes, fileSize - position, maximumBytes - bytesRead);
    const buffer = Buffer.alloc(length);
    const descriptor = fs.openSync(filePath, 'r');
    try { fs.readSync(descriptor, buffer, 0, length, position); } finally { fs.closeSync(descriptor); }
    bytesRead += length;
    for (let index = 0; index < length; index += 1) {
      const character = buffer[index];
      if (inString) {
        if (escaping) escaping = false;
        else if (character === 92) escaping = true;
        else if (character === 34) inString = false;
        continue;
      }
      if (character === 34) { inString = true; continue; }
      if (character === 123) depth += 1;
      if (character === 125 && --depth === 0) return { endOffset: position + index + 1, bytesRead, scanOffset: position + index + 1, depth, inString, escaping };
    }
    position += length;
  }
  return { endOffset: null, bytesRead, scanOffset: position, depth, inString, escaping };
}

function usableUsage(usage) {
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  const totalTokens = usage?.total_tokens;
  if (![inputTokens, outputTokens, totalTokens].every((value) => Number.isInteger(value) && value >= 0)) return null;
  if (totalTokens !== inputTokens + outputTokens) return null;
  return { inputTokens, outputTokens, totalTokens };
}

// These values come only from explicit session metadata. They are deliberately
// narrow so arbitrary source strings cannot become a stored model label.
function safeModel(value) {
  return typeof value === 'string' && MODEL_ID.test(value) ? value.toLowerCase() : null;
}

function safeEffort(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : null;
  return normalized && EFFORTS.has(normalized) ? normalized : null;
}

function turnContextAttribution(value) {
  if (value?.type !== 'turn_context' || !value.payload || typeof value.payload !== 'object') return null;
  const turnId = typeof value.payload.turn_id === 'string' && SAFE_ID.test(value.payload.turn_id) ? value.payload.turn_id : null;
  if (!turnId) return null;
  return { turnId, model: safeModel(value.payload.model), effort: safeEffort(value.payload.effort) };
}

function turnAttributions(records) {
  const values = new Map();
  for (const { value } of records) {
    const attribution = turnContextAttribution(value);
    if (!attribution) continue;
    const current = values.get(attribution.turnId) || { model: new Set(), effort: new Set() };
    if (attribution.model) current.model.add(attribution.model);
    if (attribution.effort) current.effort.add(attribution.effort);
    values.set(attribution.turnId, current);
  }
  return [...values].map(([turnId, current]) => {
    const modelValues = current ? [...current.model] : [];
    const effortValues = current ? [...current.effort] : [];
    return {
      turnId,
      model: modelValues.length === 1 ? modelValues[0] : null,
      modelState: modelValues.length === 1 ? 'available' : modelValues.length > 1 ? 'conflicting' : 'unavailable',
      effort: effortValues.length === 1 ? effortValues[0] : null,
      effortState: effortValues.length === 1 ? 'available' : effortValues.length > 1 ? 'conflicting' : 'unavailable',
    };
  });
}

function candidateForRecord(record, agent) {
  if (record?.type !== 'token_usage_record') return { kind: 'unsupported' };
  const payload = record.payload;
  const usage = usableUsage(payload?.usage);
  if (!usage) return { kind: 'unavailable-usage' };
  if (![payload.thread_id, payload.session_id, payload.turn_id, payload.response_id].every((value) => typeof value === 'string')) {
    return { kind: 'malformed' };
  }
  return {
    kind: 'candidate',
    value: {
      source: SOURCE,
      taskId: payload.thread_id,
      sessionId: payload.session_id,
      turnId: payload.turn_id,
      responseId: payload.response_id,
      taskStatus: 'active',
      agent: { name: agent?.name || null, path: agent?.path || null, origin: agent?.origin || null },
      usage,
    },
  };
}

function freshness(modifiedAt, now = Date.now()) {
  const ageMs = Math.max(0, now - modifiedAt.getTime());
  return { ageMs, state: ageMs <= 5 * 60 * 1000 ? 'fresh' : 'stale' };
}

function sourceFileId(sourceSessionId) {
  if (typeof sourceSessionId !== 'string' || !sourceSessionId) throw new Error('A source session ID is required');
  return crypto.createHash('sha256').update(`codex-rollout-session:${sourceSessionId}`).digest('hex');
}

function rolloutMetadataDiscovery(filePath, projects, registeredProjectForPath, maxBytes = DEFAULT_METADATA_MAX_BYTES) {
  const stat = fs.statSync(filePath);
  const bytesToRead = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(bytesToRead);
  if (bytesToRead) {
    const descriptor = fs.openSync(filePath, 'r');
    try { fs.readSync(descriptor, buffer, 0, bytesToRead, 0); } finally { fs.closeSync(descriptor); }
  }
  const { records } = parseJsonObjects(buffer);
  const sessionMeta = records.find(({ value }) => value?.type === 'session_meta' && typeof value?.payload?.cwd === 'string');
  const project = sessionMeta && registeredProjectForPath(sessionMeta.value.payload.cwd, projects);
  const sourceSessionId = sessionMeta?.value?.payload?.session_id || records.find(({ value }) => value?.type === 'token_usage_record')?.value?.payload?.session_id;
  if (project && typeof sourceSessionId === 'string') {
    return { state: 'attributed', metadata: { project: { id: project.id, name: project.name }, sourceFileId: sourceFileId(sourceSessionId) } };
  }
  // A complete metadata scan that did not identify a registered project is
  // safely ignored. A bounded scan that ends mid-envelope cannot make that
  // claim, so callers can expose only an aggregate incomplete count.
  const incomplete = stat.size > bytesToRead && (records.length === 0 || !sessionMeta);
  return { state: incomplete ? 'incomplete' : 'ignored', metadata: null };
}

function rolloutMetadata(filePath, projects, registeredProjectForPath, maxBytes = DEFAULT_METADATA_MAX_BYTES) {
  return rolloutMetadataDiscovery(filePath, projects, registeredProjectForPath, maxBytes).metadata;
}

function isRolloutEnvelope(value) {
  return value && typeof value === 'object' && typeof value.type === 'string'
    && Number.isInteger(value.ordinal) && typeof value.timestamp === 'string' && value.payload && typeof value.payload === 'object';
}

function resumableEnvelope(checkpoint, fileSize) {
  const envelope = checkpoint?.openEnvelope;
  if (!envelope || !Number.isInteger(envelope.startOffset) || !Number.isInteger(envelope.scanOffset)
    || !Number.isInteger(envelope.depth) || envelope.startOffset < 0 || envelope.scanOffset < envelope.startOffset
    || envelope.scanOffset > fileSize || envelope.depth < 1) return null;
  return envelope;
}

function adaptRolloutFile(filePath, options = {}) {
  const statSync = options.statSync || fs.statSync;
  const stat = statSync(filePath);
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const checkpointOffset = options.checkpoint?.offset;
  const checkpointStart = Number.isInteger(checkpointOffset) && checkpointOffset >= 0 && checkpointOffset <= stat.size;
  // Codex rollouts are a multi-line object stream, not line-valid JSONL. Start
  // a new source at byte zero so every later checkpoint is a known envelope end.
  const startOffset = checkpointStart ? checkpointOffset : 0;
  const continuation = resumableEnvelope(options.checkpoint, stat.size);
  if (continuation && continuation.startOffset < startOffset) throw new Error('Invalid rollout continuation checkpoint');
  if (continuation) {
    const resumed = findObjectEnd(filePath, continuation.scanOffset, stat.size, maxBytes, maxBytes, continuation);
    const finalStat = statSync(filePath);
    const health = {
      filesScanned: 1, bytesRead: resumed.bytesRead, recordsScanned: 0, recordsAccepted: 0, recordsSkipped: 0,
      malformedRecords: 0, recordsWithoutUsableUsage: 0, overlongRecords: resumed.endOffset === null ? 0 : 1,
      overlongPending: resumed.endOffset === null, schemaObservations: [], freshness: freshness(finalStat.mtime, options.now),
      pendingBytes: Math.max(0, finalStat.size - (resumed.endOffset === null ? startOffset : resumed.endOffset)),
    };
    health.readState = health.pendingBytes === 0 ? 'caught_up' : 'partial';
    return {
      turns: [], tasks: [], health,
      nextCheckpoint: resumed.endOffset === null
        ? { offset: startOffset, fileSize: finalStat.size, openEnvelope: { startOffset: continuation.startOffset, scanOffset: resumed.scanOffset, depth: resumed.depth, inString: resumed.inString, escaping: resumed.escaping } }
        : { offset: Math.min(resumed.endOffset, finalStat.size), fileSize: finalStat.size },
    };
  }
  const bytesToRead = Math.min(maxBytes, stat.size - startOffset);
  const buffer = Buffer.alloc(bytesToRead);
  if (bytesToRead) {
    const descriptor = fs.openSync(filePath, 'r');
    try { fs.readSync(descriptor, buffer, 0, bytesToRead, startOffset); } finally { fs.closeSync(descriptor); }
  }
  const parsed = parseJsonObjects(buffer, startOffset);
  const normalizer = options.normalizer || createRolloutNormalizer();
  const health = {
    filesScanned: 1,
    bytesRead: bytesToRead,
    recordsScanned: parsed.records.length,
    recordsAccepted: 0,
    recordsSkipped: 0,
    malformedRecords: parsed.malformedRecords,
    recordsWithoutUsableUsage: 0,
    overlongRecords: 0,
    overlongPending: false,
    schemaObservations: [],
    freshness: freshness(stat.mtime, options.now),
  };
  const schemaObservations = new Set();
  let lastSafeOffset = startOffset;
  for (const { value, endOffset, malformed } of parsed.records) {
    if (malformed) { lastSafeOffset = endOffset; continue; }
    if (!isRolloutEnvelope(value)) { health.recordsSkipped += 1; continue; }
    lastSafeOffset = endOffset;
    const candidate = candidateForRecord(value, options.agent);
    if (candidate.kind === 'unsupported') { health.recordsSkipped += 1; continue; }
    if (candidate.kind === 'unavailable-usage') { health.recordsWithoutUsableUsage += 1; continue; }
    if (candidate.kind === 'malformed') { health.malformedRecords += 1; continue; }
    schemaObservations.add('token_usage_record:response_usage_v1');
    try {
      const result = normalizer.add(candidate.value);
      if (result.accepted) health.recordsAccepted += 1;
      else health.recordsSkipped += 1;
    } catch {
      health.malformedRecords += 1;
    }
  }
  const unfinishedEnvelope = parsed.openStartOffset !== null && parsed.openStartOffset >= lastSafeOffset;
  if (unfinishedEnvelope) health.overlongPending = true;
  // The source may append while it is being read. Re-stat before producing a
  // checkpoint so newly appended bytes remain pending for the next cycle.
  const finalStat = statSync(filePath);
  health.schemaObservations = [...schemaObservations];
  if (!unfinishedEnvelope && buffer.subarray(lastSafeOffset - startOffset).toString('utf8').trim() === '') lastSafeOffset = startOffset + bytesToRead;
  health.freshness = freshness(finalStat.mtime, options.now);
  health.pendingBytes = Math.max(0, finalStat.size - lastSafeOffset);
  health.readState = health.pendingBytes === 0 ? 'caught_up' : 'partial';
  const explicitTurnAttributions = turnAttributions(parsed.records);
  return {
    turns: normalizer.snapshot().turns,
    tasks: normalizer.snapshot().tasks,
    turnAttributions: explicitTurnAttributions,
    health,
    nextCheckpoint: unfinishedEnvelope
      ? { offset: startOffset, fileSize: finalStat.size, openEnvelope: { startOffset: parsed.openStartOffset, ...parsed.openState } }
      : { offset: Math.min(lastSafeOffset, finalStat.size), fileSize: finalStat.size },
  };
}

module.exports = { DEFAULT_METADATA_MAX_BYTES, EFFORTS, MODEL_ID, SOURCE, adaptRolloutFile, candidateForRecord, findObjectEnd, parseJsonObjects, resumableEnvelope, rolloutMetadata, rolloutMetadataDiscovery, safeEffort, safeModel, sourceFileId, turnAttributions, turnContextAttribution, usableUsage };
