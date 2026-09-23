const ROLE_REGISTRY = Object.freeze([
  {
    key: 'manager',
    label: 'Manager',
    aliases: ['manager', 'foundation_architecture', 'foundation-architecture'],
  },
  {
    key: 'generalist',
    label: 'Generalist',
    aliases: ['generalist', 'agent', 'default'],
  },
  {
    key: 'frontend',
    label: 'Frontend',
    aliases: ['frontend', 'frontend_builder', 'dashboard_frontend', 'dashboard-frontend'],
  },
  {
    key: 'backend',
    label: 'Backend',
    aliases: ['backend', 'backend_builder', 'backend_integrations', 'backend-integrations'],
  },
  {
    key: 'reviewer',
    label: 'Reviewer',
    aliases: ['reviewer', 'qa_security', 'qa-security'],
  },
]);

const UNKNOWN_ROLE = Object.freeze({ key: 'unknown', label: 'Unknown role' });
const SYSTEM_GUARDIAN_NAMES = new Set(['guardian', 'system_guardian', 'safety_guardian']);

function normalizeAgentName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalized || null;
}

function agentPathSegments(value) {
  if (typeof value !== 'string') return [];
  return value.split(/[\\/]+/).map(normalizeAgentName).filter(Boolean);
}

function sourceNames(source = {}) {
  return [normalizeAgentName(source.agentName), ...agentPathSegments(source.agentPath)];
}

function isSystemGuardian(source = {}) {
  const path = agentPathSegments(source.agentPath);
  const name = normalizeAgentName(source.agentName);
  return path[0] === 'system' && (path.includes('guardian') || SYSTEM_GUARDIAN_NAMES.has(path.at(-1)))
    || source.origin === 'system' && SYSTEM_GUARDIAN_NAMES.has(name);
}

function roleForSource(source = {}) {
  if (isSystemGuardian(source)) {
    return { ...UNKNOWN_ROLE, population: 'system_guardian', countedInProjectTotals: false, match: 'system-guardian' };
  }

  const names = sourceNames(source);
  const role = ROLE_REGISTRY.find((entry) => entry.aliases.some((alias) => names.includes(normalizeAgentName(alias))));
  if (!role) return { ...UNKNOWN_ROLE, population: 'project_agent', countedInProjectTotals: true, match: 'unknown' };
  return { key: role.key, label: role.label, population: 'project_agent', countedInProjectTotals: true, match: 'registry-alias' };
}

module.exports = { ROLE_REGISTRY, UNKNOWN_ROLE, agentPathSegments, isSystemGuardian, normalizeAgentName, roleForSource };
