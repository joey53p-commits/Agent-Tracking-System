const FORBIDDEN_KEYS = /token|secret|password|cookie|authorization|env(?:ironment)?|prompt|transcript|command|toolOutput|rawOutput/i;
const SECRET_VALUE_PATTERNS = [
  /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /(?:api[_-]?key|password|token|secret)\s*[:=]\s*\S+/i,
];

function findUnsafeContent(value, path = 'event') {
  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ? [path] : [];
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.test(key)) return [childPath];
    return findUnsafeContent(child, childPath);
  });
}

function assertSafeEvent(candidate) {
  const unsafePaths = findUnsafeContent(candidate);
  if (unsafePaths.length) throw new Error(`Event rejected by privacy policy: ${unsafePaths.join(', ')}`);
}

module.exports = { assertSafeEvent, findUnsafeContent };
