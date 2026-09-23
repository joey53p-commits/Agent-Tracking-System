const { roleForSource } = require('../agent-registry');

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const FORBIDDEN_KEYS = /^(?:path|cwd|prompt|message|messages|reasoning|tool|toolData|command|code|diff|transcript|raw|sessionUsage|threadUsage)$/i;
const TASK_STATUSES = new Set(['active', 'completed']);

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${field} must be a safe opaque identifier`);
  return value;
}

function sourceQualifiedId(source, kind, id) {
  return `${safeId(source, 'source')}::${kind}::${safeId(id, `${kind}Id`)}`;
}

function assertNoForbiddenFields(value, field = 'record') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const transientAgentPath = field === 'record.agent' && key === 'path';
    if (FORBIDDEN_KEYS.test(key) && !transientAgentPath) throw new Error(`${field}.${key} is excluded by the privacy contract`);
    assertNoForbiddenFields(child, `${field}.${key}`);
  }
}

function normalizeUsage(usage) {
  const fields = ['inputTokens', 'outputTokens', 'totalTokens'];
  if (!usage || typeof usage !== 'object') throw new Error('usage is required');
  const normalized = Object.fromEntries(fields.map((field) => {
    if (!Number.isInteger(usage[field]) || usage[field] < 0) throw new Error(`usage.${field} must be a non-negative integer`);
    return [field, usage[field]];
  }));
  if (normalized.totalTokens !== normalized.inputTokens + normalized.outputTokens) {
    throw new Error('usage.totalTokens must equal inputTokens plus outputTokens');
  }
  return normalized;
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addUsage(total, usage) {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  };
}

function createRolloutNormalizer() {
  const tasks = new Map();
  const turns = [];
  const responseIds = new Set();

  function add(record) {
    assertNoForbiddenFields(record);
    const source = safeId(record?.source, 'source');
    const taskId = sourceQualifiedId(source, 'task', record?.taskId);
    const sessionId = sourceQualifiedId(source, 'session', record?.sessionId);
    const turnId = sourceQualifiedId(source, 'turn', record?.turnId);
    const responseId = sourceQualifiedId(source, 'response', record?.responseId);
    const status = record?.taskStatus || 'active';
    if (!TASK_STATUSES.has(status)) throw new Error('taskStatus must be active or completed');
    if (responseIds.has(responseId)) return { accepted: false, reason: 'duplicate-response', responseId };

    const existing = tasks.get(taskId);
    if (existing?.isComplete) return { accepted: false, reason: 'completed-task', taskId };
    const usage = normalizeUsage(record?.usage);
    const agent = roleForSource({
      agentName: record?.agent?.name,
      agentPath: record?.agent?.path,
      origin: record?.agent?.origin,
    });
    const turn = Object.freeze({ taskId, sessionId, turnId, responseId, usage, agent });
    const task = existing || { taskId, status: 'active', isComplete: false, usage: emptyUsage(), turnCount: 0 };
    task.usage = addUsage(task.usage, usage);
    task.turnCount += 1;
    task.status = status;
    task.isComplete = status === 'completed';
    tasks.set(taskId, task);
    turns.push(turn);
    responseIds.add(responseId);
    return { accepted: true, turn };
  }

  function snapshot() {
    return {
      tasks: [...tasks.values()].map((task) => ({ ...task, usage: { ...task.usage } })),
      turns: [...turns],
    };
  }

  return { add, snapshot };
}

function aggregateAgentUsage(turns) {
  const projectAgents = new Map();
  const systemGuardians = new Map();
  for (const turn of turns) {
    const target = turn.agent.countedInProjectTotals ? projectAgents : systemGuardians;
    const current = target.get(turn.agent.key) || { roleKey: turn.agent.key, label: turn.agent.label, usage: emptyUsage(), turnCount: 0 };
    current.usage = addUsage(current.usage, turn.usage);
    current.turnCount += 1;
    target.set(turn.agent.key, current);
  }
  return { projectAgents: [...projectAgents.values()], systemGuardians: [...systemGuardians.values()] };
}

module.exports = { addUsage, aggregateAgentUsage, createRolloutNormalizer, normalizeUsage, sourceQualifiedId };
