const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadContext({ fetch } = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const setup = source.slice(0, source.indexOf("document.querySelectorAll('[data-page]')"));
  const elements = {
    '#tracking-status-panel': { innerHTML: '', classList: { remove() {}, add() {} } },
    '#rollout-empty-state': { hidden: true, innerHTML: 'The registered project is configured, but no eligible Codex rollout usage has been saved yet.' },
    '#rollout-project-list': { innerHTML: '' },
  };
  const context = { document: { querySelector: (selector) => elements[selector] }, fetch, Intl, Date, Number, String };
  vm.runInNewContext(`${setup}; globalThis.render = renderRolloutOverview; globalThis.loadRollout = loadRolloutOverview;`, context);
  return { context, elements };
}

function project(name, { readState = 'caught_up', pendingBytes = 0, latestIngestionAt = '2026-09-15T12:00:00.000Z' } = {}) {
  const ingested = Boolean(latestIngestionAt);
  return { project: { name }, sourceHealth: ingested ? { latestIngestionAt, freshnessState: 'fresh', readState, pendingBytes } : null, totals: { activeTasks: ingested ? 1 : 0, completedTasks: 0, exactResponseUsage: { inputTokens: ingested ? 11 : 0, outputTokens: ingested ? 4 : 0, totalTokens: ingested ? 15 : 0 } }, tasks: ingested ? [{ taskId: 'safe-task', state: 'active_incomplete', turnCount: 1, exactTokenTotal: 15, roleLabel: 'Unknown role' }] : [], roles: ingested ? [{ roleLabel: 'Unknown role', turnCount: 1, exactTokenTotal: 15 }] : [] };
}

test('Overview UI renders a visible top tracking-status panel with honest freshness', () => {
  const { context, elements } = loadContext();
  context.render({ hasRolloutRecords: true, monitorCycle: { completedAt: '2026-09-15T12:01:00.000Z', durationMs: 25, sourcesFound: 1, ignoredSources: 0, incompleteAttributionSources: 0, discoveryErrors: 0, failures: 0, persisted: 1, duplicatesIgnored: 0, caughtUpSources: 1, partialSources: 0, unavailableSources: 0, pendingBytes: 0, backlogState: 'caught_up' }, projects: [project('Agent Tracking System')] });
  assert.match(elements['#tracking-status-panel'].innerHTML, /TRACKING STATUS/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Agent Tracking System/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Last successful ingestion/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Last completed monitor cycle/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Cycle backlog state/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Caught Up/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /does not indicate whether a monitor is running/);
});

test('Overview UI renders an absent or incomplete cycle as historical status, never liveness', () => {
  const { context, elements } = loadContext();
  context.render({ hasRolloutRecords: false, monitorCycle: { completedAt: '2026-09-15T12:01:00.000Z', durationMs: 10, sourcesFound: 0, ignoredSources: 4, incompleteAttributionSources: 2, discoveryErrors: 1, failures: 1, persisted: 0, duplicatesIgnored: 0, caughtUpSources: 0, partialSources: 0, unavailableSources: 1, pendingBytes: 0, backlogState: 'incomplete_discovery' }, projects: [] });
  assert.match(elements['#tracking-status-panel'].innerHTML, /Incomplete Discovery/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /2 sources/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /does not indicate whether a monitor is running/);
});

test('Overview UI explains configured registered projects with no saved eligible usage', () => {
  const { context, elements } = loadContext();
  context.render({ hasRolloutRecords: false, projects: [project('Agent Tracking System', { latestIngestionAt: null })] });
  assert.equal(elements['#rollout-empty-state'].hidden, false);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Agent Tracking System/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Not Yet Ingested/);
  assert.match(elements['#rollout-empty-state'].innerHTML, /configured, but no eligible Codex rollout usage has been saved yet/);
});

test('Overview UI makes partial source totals and meaningful pending bytes obvious', () => {
  const { context, elements } = loadContext();
  context.render({ hasRolloutRecords: true, projects: [project('Agent Tracking System', { readState: 'partial', pendingBytes: 19 })] });
  assert.match(elements['#tracking-status-panel'].innerHTML, /Partial/);
  assert.match(elements['#tracking-status-panel'].innerHTML, /Displayed totals are incomplete until the next successful monitor cycle/);
  assert.match(elements['#rollout-project-list'].innerHTML, /Pending local data/);
  assert.match(elements['#rollout-project-list'].innerHTML, /19 bytes/);
});

test('a local Overview API error is prominent and Retry performs only another GET', async () => {
  let calls = 0;
  const { context, elements } = loadContext({ fetch: async () => { calls += 1; throw new Error('unavailable'); } });
  let retry;
  const panel = elements['#tracking-status-panel'];
  panel.classList = { remove() {}, add(value) { assert.equal(value, 'error'); } };
  const originalQuery = context.document.querySelector;
  context.document.querySelector = (selector) => selector === '#rollout-retry' ? { addEventListener: (_event, handler) => { retry = handler; } } : originalQuery(selector);
  await context.loadRollout();
  assert.match(panel.innerHTML, /Local Overview unavailable/);
  assert.match(panel.innerHTML, /Retry/);
  retry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

test('multiple projects label each task and usage section with its registered project', () => {
  const { context, elements } = loadContext();
  context.render({ hasRolloutRecords: true, projects: [project('Agent Tracking System'), project('Rise')] });
  assert.match(elements['#tracking-status-panel'].innerHTML, /Agent Tracking System · Rise/);
  assert.match(elements['#rollout-project-list'].innerHTML, /Tasks — Agent Tracking System/);
  assert.match(elements['#rollout-project-list'].innerHTML, /Agent \/ role totals — Rise/);
  assert.match(elements['#rollout-project-list'].innerHTML, /aria-label="Rise usage summary"/);
});
