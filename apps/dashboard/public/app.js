const filters = ['project', 'workstream', 'status'];
const runtimeModels = {
  Codex: ['', 'GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5', 'GPT-5.4 Mini'],
  ChatGPT: ['', 'GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'Other'],
  Other: ['', 'Other'],
};
let dashboardData = null;

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function populateSelect(id, values, selected, formatter = label) { const select = document.querySelector(`#${id}`); const value = selected ?? select.value; select.innerHTML = ''; values.forEach((item) => select.add(new Option(formatter(item), item, false, item === value))); }
function populateFilter(name, values) { const select = document.querySelector(`#${name}-filter`); const selected = select.value; select.innerHTML = `<option value="">All ${name === 'status' ? 'statuses' : `${name}s`}</option>`; values.forEach((item) => select.add(new Option(label(item), item, false, item === selected))); }
function populateModels(id, runtime, selected = '') { populateSelect(id, runtimeModels[runtime] || runtimeModels.Other, selected, (value) => value || 'Not specified'); }
function setStartedAtDefault() { const input = document.querySelector('#started-at'); if (!input.value) input.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

function activeProfile() { return dashboardData?.agents.find((agent) => agent.agent_id === document.querySelector('#agent-profile').value); }
function updateActiveProfile() {
  const profile = activeProfile(); const context = document.querySelector('#agent-context');
  if (!profile) { context.textContent = 'No active agent profiles exist for this project yet. Add one below.'; return; }
  document.querySelector('#runtime').value = profile.runtime;
  populateModels('model', profile.runtime, profile.default_model || '');
  context.textContent = `Role: ${profile.role}. Default runtime: ${profile.runtime}${profile.default_model ? ` · default model: ${profile.default_model}` : ''}.`;
}
function populateAgentProfiles(preferred) {
  const profiles = (dashboardData?.agents || []).filter((agent) => agent.project === document.querySelector('#form-project').value);
  const select = document.querySelector('#agent-profile'); const previous = preferred || select.value;
  select.innerHTML = '<option value="" disabled>Select an agent</option>';
  profiles.forEach((agent) => select.add(new Option(`${agent.display_name} — ${agent.role}`, agent.agent_id, false, agent.agent_id === previous)));
  if (!select.value && profiles.length) select.value = profiles[0].agent_id;
  updateActiveProfile();
}
function populateCaptureForm(catalog) {
  populateSelect('form-project', catalog.projects, document.querySelector('#form-project').value || 'Rise');
  populateSelect('form-workstream', catalog.workstreams, document.querySelector('#form-workstream').value || 'Quality Assurance');
  populateSelect('form-status', catalog.statuses, document.querySelector('#form-status').value || 'completed');
  populateSelect('outcome', ['accepted', 'needs_review', 'reworked', 'not_applicable', 'unknown'], document.querySelector('#outcome').value || 'accepted');
  populateSelect('runtime', Object.keys(runtimeModels), document.querySelector('#runtime').value || 'Codex');
  populateSelect('agent-project', catalog.projects, document.querySelector('#agent-project').value || 'Rise');
  populateSelect('agent-runtime', Object.keys(runtimeModels), document.querySelector('#agent-runtime').value || 'Codex');
  populateModels('agent-model', document.querySelector('#agent-runtime').value, document.querySelector('#agent-model').value);
  populateAgentProfiles();
}
function resetCaptureForm() { document.querySelector('#task-form').reset(); document.querySelector('#form-project').value = 'Rise'; document.querySelector('#form-workstream').value = 'Quality Assurance'; document.querySelector('#form-status').value = 'completed'; document.querySelector('#outcome').value = 'accepted'; populateAgentProfiles(); setStartedAtDefault(); }

function renderMetrics(totals) { document.querySelector('#total-tasks').textContent = totals.totalTasks || 0; document.querySelector('#completed-tasks').textContent = totals.completedTasks || 0; document.querySelector('#interrupted-tasks').textContent = totals.interruptedTasks || 0; document.querySelector('#retries').textContent = totals.retries || 0; }
function renderWorkstreams(items) { document.querySelector('#workstreams').innerHTML = items.length ? items.map((item) => `<div class="workstream-row"><div><strong>${escapeHtml(item.workstream)}</strong><span>${escapeHtml(item.project)}</span></div><div><strong>${item.completedCount}/${item.taskCount}</strong><span>completed</span></div></div>`).join('') : '<p class="quiet">Workstream summaries appear after the first task is recorded.</p>'; }
function renderAgentList(agents) { document.querySelector('#agent-list').innerHTML = agents.length ? agents.map((agent) => `<article class="agent-card"><strong>${escapeHtml(agent.display_name)}</strong><span>${escapeHtml(agent.project)} · ${escapeHtml(agent.role)}</span><small>${escapeHtml(agent.runtime)}${agent.default_model ? ` · ${escapeHtml(agent.default_model)}` : ''}</small></article>`).join('') : '<p class="quiet">Add the first agent profile to begin role-level tracking.</p>'; }
function renderTasks(events) { const filtered = filters.some((name) => document.querySelector(`#${name}-filter`).value); document.querySelector('#task-count').textContent = `${events.length} shown`; document.querySelector('#empty-state').hidden = events.length > 0; document.querySelector('#empty-state h3').textContent = filtered ? 'No tasks match these filters' : 'No tasks recorded yet'; document.querySelector('#empty-state p').textContent = filtered ? 'Try a different filter combination, or clear the filters to review all recorded work.' : 'Use the form above to record a reviewed task event. It will appear here immediately.'; document.querySelector('#task-list').innerHTML = events.map((event) => `<article class="task-card"><div class="task-main"><div class="task-title-row"><h3>${escapeHtml(event.task_title)}</h3><span class="status ${escapeHtml(event.execution_status)}">${label(event.execution_status)}</span></div><p>${escapeHtml(event.project)} · ${escapeHtml(event.workstream)} · ${escapeHtml(event.agent)}${event.agent_role ? ` (${escapeHtml(event.agent_role)})` : ''}${event.runtime ? ` · ${escapeHtml(event.runtime)}` : ''}${event.model ? ` · ${escapeHtml(event.model)}` : ''}</p><div class="evidence">${event.validation.length ? event.validation.map((item) => `<span>${escapeHtml(item)}</span>`).join('') : '<span>No validation recorded</span>'}</div></div><div class="task-meta"><strong>${label(event.outcome_result)}</strong><span>${event.retry_count} retries</span></div></article>`).join(''); }

async function loadDashboard() {
  const parameters = new URLSearchParams(); filters.forEach((name) => { const value = document.querySelector(`#${name}-filter`).value; if (value) parameters.set(name, value); });
  const response = await fetch(`/api/overview?${parameters}`); if (!response.ok) throw new Error('Unable to load local dashboard data.'); dashboardData = await response.json();
  populateFilter('project', dashboardData.filters.projects); populateFilter('workstream', dashboardData.filters.workstreams); populateFilter('status', dashboardData.filters.statuses); populateCaptureForm(dashboardData.filters); setStartedAtDefault(); renderMetrics(dashboardData.summary.totals); renderWorkstreams(dashboardData.summary.workstreams); renderAgentList(dashboardData.agents); renderTasks(dashboardData.events);
}
function lines(id) { return document.querySelector(`#${id}`).value.split('\n').map((value) => value.trim()).filter(Boolean); }
function toIso(id) { const value = document.querySelector(`#${id}`).value; return value ? new Date(value).toISOString() : null; }
async function submitTask(event) {
  event.preventDefault(); const profile = activeProfile(); if (!profile) throw new Error('Select an agent profile before recording this task.'); const message = document.querySelector('#form-message'); const status = document.querySelector('#form-status').value;
  const candidate = { task: { id: `local-${crypto.randomUUID()}`, title: document.querySelector('#task-title').value.trim(), project: document.querySelector('#form-project').value, workstream: document.querySelector('#form-workstream').value }, assignment: { agentId: profile.agent_id, role: profile.role }, execution: { agent: profile.display_name, runtime: document.querySelector('#runtime').value, model: document.querySelector('#model').value || null, startedAt: toIso('started-at'), completedAt: status === 'completed' ? new Date().toISOString() : null, status }, outcome: { result: document.querySelector('#outcome').value, retryCount: Number(document.querySelector('#retry-count').value), blocker: document.querySelector('#blocker').value.trim() || null, validation: lines('validation') }, references: { repository: document.querySelector('#repository').value.trim() || null, branch: document.querySelector('#branch').value.trim() || null, commit: document.querySelector('#commit').value.trim() || null, changedFiles: lines('changed-files') } };
  message.textContent = 'Recording task…'; const response = await fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) }); if (!response.ok) throw new Error('Unable to record this task. Check required fields and avoid private content.'); resetCaptureForm(); message.textContent = 'Task recorded locally.'; await loadDashboard();
}
async function submitAgent(event) {
  event.preventDefault(); const message = document.querySelector('#agent-message'); const candidate = { displayName: document.querySelector('#agent-name').value.trim(), project: document.querySelector('#agent-project').value, role: document.querySelector('#agent-role').value.trim(), runtime: document.querySelector('#agent-runtime').value, defaultModel: document.querySelector('#agent-model').value || null };
  message.textContent = 'Adding agent…'; const response = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) }); if (!response.ok) throw new Error('Unable to add this agent. Check the required fields.'); const { agent } = await response.json(); document.querySelector('#agent-form').reset(); message.textContent = 'Agent profile added.'; await loadDashboard(); document.querySelector('#form-project').value = agent.project; populateAgentProfiles(agent.agent_id);
}
function showError() { document.querySelector('#task-list').innerHTML = '<p class="error">The dashboard could not load the local tracker database.</p>'; }
filters.forEach((name) => document.querySelector(`#${name}-filter`).addEventListener('change', () => loadDashboard().catch(showError)));
document.querySelector('#clear-filters').addEventListener('click', () => { filters.forEach((name) => { document.querySelector(`#${name}-filter`).value = ''; }); loadDashboard().catch(showError); });
document.querySelector('#form-project').addEventListener('change', () => populateAgentProfiles());
document.querySelector('#agent-profile').addEventListener('change', updateActiveProfile);
document.querySelector('#runtime').addEventListener('change', () => populateModels('model', document.querySelector('#runtime').value));
document.querySelector('#agent-runtime').addEventListener('change', () => populateModels('agent-model', document.querySelector('#agent-runtime').value));
document.querySelector('#task-form').addEventListener('submit', (event) => submitTask(event).catch((error) => { document.querySelector('#form-message').textContent = error.message; }));
document.querySelector('#agent-form').addEventListener('submit', (event) => submitAgent(event).catch((error) => { document.querySelector('#agent-message').textContent = error.message; }));
loadDashboard().catch(showError);
