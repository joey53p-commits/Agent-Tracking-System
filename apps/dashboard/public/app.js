const filters = ['project', 'workstream', 'status'];
const runtimeModels = { Codex: ['', 'GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5', 'GPT-5.4 Mini'], ChatGPT: ['', 'GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'Other'], Other: ['', 'Other'] };
const pageCopy = { overview: ['LOCAL PILOT', 'Overview', 'See what is moving, what needs attention, and where to focus next.'], work: ['WORK TRACKING', 'Work', 'Record agent work, follow active tasks, and review the evidence behind each result.'], agents: ['AGENT REGISTRY', 'Agents', 'Manage the individual agents and project roles you want to evaluate over time.'], settings: ['LOCAL SETTINGS', 'Settings', 'Review the privacy-first local configuration for this tracker.'] };
let dashboardData = null;
let rolloutOverviewData = null;
let projectGitOverviewData = null;
let selectedAgentId = null;
const ROLLOUT_REFRESH_INTERVAL_MS = 15000;
let rolloutRefreshPromise = null;
let projectGitRefreshPromise = null;
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function populateSelect(id, values, selected, formatter = label) { const select = document.querySelector(`#${id}`); const value = selected ?? select.value; select.innerHTML = ''; values.forEach((item) => select.add(new Option(formatter(item), item, false, item === value))); }
function populateFilter(name, values) { const select = document.querySelector(`#${name}-filter`); const selected = select.value; select.innerHTML = `<option value="">All ${name === 'status' ? 'statuses' : `${name}s`}</option>`; values.forEach((item) => select.add(new Option(label(item), item, false, item === selected))); }
function populateModels(id, runtime, selected = '') { populateSelect(id, runtimeModels[runtime] || runtimeModels.Other, selected, (value) => value || 'Not specified'); }
function setStartedAtDefault() { const input = document.querySelector('#started-at'); if (!input.value) input.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function activeProfile() { return dashboardData?.agents.find((agent) => agent.agent_id === document.querySelector('#agent-profile').value); }
function updateActiveProfile() { const profile = activeProfile(); const context = document.querySelector('#agent-context'); if (!profile) { context.textContent = 'No active agent profiles exist for this project yet. Add one on the Agents page.'; return; } document.querySelector('#runtime').value = profile.runtime; populateModels('model', profile.runtime, profile.default_model || ''); context.textContent = `Role: ${profile.role}. Default runtime: ${profile.runtime}${profile.default_model ? ` · default model: ${profile.default_model}` : ''}.`; }
function populateAgentProfiles(preferred) { const profiles = (dashboardData?.agents || []).filter((agent) => agent.project === document.querySelector('#form-project').value); const select = document.querySelector('#agent-profile'); const previous = preferred || select.value; select.innerHTML = '<option value="" disabled>Select an agent</option>'; profiles.forEach((agent) => select.add(new Option(`${agent.display_name} — ${agent.role}`, agent.agent_id, false, agent.agent_id === previous))); if (!select.value && profiles.length) select.value = profiles[0].agent_id; updateActiveProfile(); }
function populateCaptureForm(catalog) { populateSelect('form-project', catalog.projects, document.querySelector('#form-project').value || 'Rise'); populateSelect('form-workstream', catalog.workstreams, document.querySelector('#form-workstream').value || 'Quality Assurance'); populateSelect('form-status', catalog.statuses, document.querySelector('#form-status').value || 'completed'); populateSelect('outcome', ['accepted', 'needs_review', 'reworked', 'not_applicable', 'unknown'], document.querySelector('#outcome').value || 'accepted'); populateSelect('runtime', Object.keys(runtimeModels), document.querySelector('#runtime').value || 'Codex'); populateSelect('agent-project', catalog.projects, document.querySelector('#agent-project').value || 'Rise'); populateSelect('agent-runtime', Object.keys(runtimeModels), document.querySelector('#agent-runtime').value || 'Codex'); populateModels('agent-model', document.querySelector('#agent-runtime').value, document.querySelector('#agent-model').value); populateAgentProfiles(); }
function resetCaptureForm() { document.querySelector('#task-form').reset(); document.querySelector('#form-project').value = 'Rise'; document.querySelector('#form-workstream').value = 'Quality Assurance'; document.querySelector('#form-status').value = 'completed'; document.querySelector('#outcome').value = 'accepted'; populateAgentProfiles(); setStartedAtDefault(); }
function renderMetrics(totals) { document.querySelector('#total-tasks').textContent = totals.totalTasks || 0; document.querySelector('#completed-tasks').textContent = totals.completedTasks || 0; document.querySelector('#interrupted-tasks').textContent = totals.interruptedTasks || 0; document.querySelector('#retries').textContent = totals.retries || 0; }
function taskMarkup(event, compact = false) { return `<article class="task-card${compact ? ' compact' : ''}"><div class="task-main"><div class="task-title-row"><h3>${escapeHtml(event.task_title)}</h3><span class="status ${escapeHtml(event.execution_status)}">${label(event.execution_status)}</span></div><p>${escapeHtml(event.project)} · ${escapeHtml(event.workstream)} · ${escapeHtml(event.agent)}${event.agent_role ? ` (${escapeHtml(event.agent_role)})` : ''}${event.runtime ? ` · ${escapeHtml(event.runtime)}` : ''}${event.model ? ` · ${escapeHtml(event.model)}` : ''}</p><div class="evidence">${event.validation.length ? event.validation.map((item) => `<span>${escapeHtml(item)}</span>`).join('') : '<span>No validation recorded</span>'}</div></div><div class="task-meta"><strong>${label(event.outcome_result)}</strong><span>${event.retry_count} retries</span></div></article>`; }
function renderTasks(events) { const filtered = filters.some((name) => document.querySelector(`#${name}-filter`).value); document.querySelector('#task-count').textContent = `${events.length} shown`; document.querySelector('#empty-state').hidden = events.length > 0; document.querySelector('#empty-state h3').textContent = filtered ? 'No tasks match these filters' : 'No tasks recorded yet'; document.querySelector('#empty-state p').textContent = filtered ? 'Try a different filter combination, or clear the filters to review all recorded work.' : 'Use Record work to add a reviewed task event.'; document.querySelector('#task-list').innerHTML = events.map((event) => taskMarkup(event)).join(''); }
function renderWorkstreams(items) { document.querySelector('#workstreams').innerHTML = items.length ? items.map((item) => `<div class="workstream-row"><div><strong>${escapeHtml(item.workstream)}</strong><span>${escapeHtml(item.project)}</span></div><div><strong>${item.completedCount}/${item.taskCount}</strong><span>completed</span></div></div>`).join('') : '<p class="quiet">Workstream summaries appear after the first task is recorded.</p>'; }
function renderAgentDetail() {
  const performance = dashboardData.agentPerformance || [];
  if (!selectedAgentId && performance.length) selectedAgentId = performance[0].agent_id;
  const agent = performance.find((item) => item.agent_id === selectedAgentId);
  const container = document.querySelector('#agent-detail');
  if (!agent) { container.innerHTML = '<p class="quiet">Select an agent to inspect its task evidence.</p>'; return; }
  const tasks = dashboardData.events.filter((event) => event.agent_profile_id === agent.agent_id);
  const issues = tasks.filter((event) => ['blocked', 'failed', 'waiting_for_approval'].includes(event.execution_status));
  container.innerHTML = `<div class="agent-detail-heading"><div><p class="eyebrow">AGENT DETAIL</p><h2>${escapeHtml(agent.display_name)}</h2><p>${escapeHtml(agent.project)} · ${escapeHtml(agent.role)} · ${escapeHtml(agent.runtime)}${agent.default_model ? ` · ${escapeHtml(agent.default_model)}` : ''}</p></div><span class="status ${agent.attentionTasks ? 'blocked' : 'completed'}">${agent.hasEnoughData ? 'Evidence available' : 'Building evidence'}</span></div><div class="detail-metrics"><div><span>Tasks recorded</span><strong>${agent.totalTasks}</strong></div><div><span>Completion rate</span><strong>${agent.completionRate == null ? '—' : `${agent.completionRate}%`}</strong></div><div><span>Needs attention</span><strong>${agent.attentionTasks}</strong></div><div><span>Average retries</span><strong>${agent.averageRetries == null ? '—' : agent.averageRetries}</strong></div><div><span>Validation coverage</span><strong>${agent.validationCoverage == null ? '—' : `${agent.validationCoverage}%`}</strong></div><div><span>Failed tasks</span><strong>${agent.failedTasks}</strong></div><div><span>Active / queued</span><strong>${agent.activeTasks}</strong></div><div><span>Evidence threshold</span><strong>${agent.hasEnoughData ? 'Met' : `${agent.totalTasks}/3`}</strong></div></div><div class="agent-detail-grid"><div><h3>Recent task evidence</h3>${tasks.length ? tasks.slice(0, 4).map((event) => taskMarkup(event, true)).join('') : '<p class="quiet">No recorded work yet. Metrics will populate as reviewed tasks are added.</p>'}</div><div><h3>Problems to inspect</h3>${issues.length ? issues.slice(0, 4).map((event) => `<div class="attention-item"><strong>${escapeHtml(event.task_title)}</strong><span>${label(event.execution_status)}${event.outcome_blocker ? ` · ${escapeHtml(event.outcome_blocker)}` : ''}</span></div>`).join('') : '<p class="quiet">No blocked, failed, or approval-waiting tasks recorded.</p>'}</div></div>`;
}
function renderAgents(agents) { const performance = dashboardData.agentPerformance || []; document.querySelector('#agent-performance-list').innerHTML = performance.length ? performance.map((agent) => `<button class="agent-performance-card${agent.agent_id === selectedAgentId ? ' selected' : ''}" type="button" data-agent-id="${escapeHtml(agent.agent_id)}"><strong>${escapeHtml(agent.display_name)}</strong><span>${escapeHtml(agent.role)}</span><div class="agent-card-metrics"><div><b>${agent.totalTasks}</b><small>tasks</small></div><div><b>${agent.completionRate == null ? '—' : `${agent.completionRate}%`}</b><small>completed</small></div><div><b>${agent.attentionTasks}</b><small>attention</small></div></div><p class="data-note">${agent.hasEnoughData ? 'Select to inspect evidence' : `Needs ${Math.max(0, 3 - agent.totalTasks)} more task records`}</p></button>`).join('') : '<p class="quiet">Add an agent profile to begin role-level tracking.</p>'; document.querySelector('#agent-list').innerHTML = agents.length ? agents.map((agent) => `<article class="agent-card"><strong>${escapeHtml(agent.display_name)}</strong><span>${escapeHtml(agent.project)} · ${escapeHtml(agent.role)}</span><small>${escapeHtml(agent.runtime)}${agent.default_model ? ` · ${escapeHtml(agent.default_model)}` : ''}</small></article>`).join('') : '<p class="quiet">Add the first agent profile to begin role-level tracking.</p>'; document.querySelectorAll('[data-agent-id]').forEach((button) => button.addEventListener('click', () => { selectedAgentId = button.dataset.agentId; renderAgents(dashboardData.agents); renderAgentDetail(); })); renderAgentDetail(); }
function renderOverview(events) { const attention = events.filter((event) => ['blocked', 'failed', 'in_progress', 'waiting_for_approval'].includes(event.execution_status)); document.querySelector('#attention-list').innerHTML = attention.length ? attention.slice(0, 5).map((event) => `<div class="attention-item"><strong>${escapeHtml(event.task_title)}</strong><span>${label(event.execution_status)} · ${escapeHtml(event.workstream)}</span></div>`).join('') : '<p class="quiet">Nothing needs attention yet. Blocked or active work will appear here.</p>'; document.querySelector('#recent-task-list').innerHTML = events.length ? events.slice(0, 4).map((event) => taskMarkup(event, true)).join('') : '<p class="quiet">Your recent completed and active work will appear here.</p>'; document.querySelector('#active-task-list').innerHTML = attention.length ? attention.map((event) => taskMarkup(event)).join('') : '<div class="empty-state"><h3>No active or interrupted work</h3><p>Tasks marked in progress, blocked, failed, or awaiting approval will appear here.</p></div>'; }
function formatCount(value) { return Number(value || 0).toLocaleString(); }
function formatTime(value) { return value ? new Date(value).toLocaleString() : 'No ingestion recorded'; }
function trackingState(record) {
  if (!record.sourceHealth) return 'not_yet_ingested';
  return record.sourceHealth.readState === 'partial' ? 'partial' : 'caught_up';
}
function trackingStateCopy(state) {
  return {
    caught_up: 'The latest local source snapshot was fully read. Totals are current only as of the last successful ingestion.',
    partial: 'More local data remains to be read. Displayed totals are incomplete until the next successful monitor cycle.',
    unavailable: 'The local Overview API is unavailable, so current tracking data cannot be confirmed.',
    not_yet_ingested: 'This registered project has not yet produced a successful local ingestion snapshot.',
  }[state];
}
function overallTrackingState(projects) {
  const states = projects.map(trackingState);
  if (states.includes('partial')) return 'partial';
  if (states.includes('caught_up')) return 'caught_up';
  return 'not_yet_ingested';
}
function renderTrackingStatus(overview) {
  const panel = document.querySelector('#tracking-status-panel');
  const projects = overview.projects || [];
  const state = overallTrackingState(projects);
  const latestIngestionAt = projects.reduce((latest, record) => {
    const candidate = record.sourceHealth?.latestIngestionAt;
    return candidate && (!latest || candidate > latest) ? candidate : latest;
  }, null);
  const names = projects.map((record) => record.project.name);
  const cycle = overview.monitorCycle;
  const cycleState = cycle ? label(cycle.backlogState) : 'No completed cycle recorded';
  const cycleTime = cycle ? formatTime(cycle.completedAt) : 'No completed cycle recorded';
  const cycleDetails = cycle
    ? `<div><span>Last completed monitor cycle</span><strong>${escapeHtml(cycleTime)}</strong></div><div><span>Cycle backlog state</span><strong>${escapeHtml(cycleState)}</strong></div><div><span>Cycle pending data</span><strong>${formatCount(cycle.pendingBytes)} bytes</strong></div><div><span>Incomplete discovery</span><strong>${formatCount(cycle.incompleteAttributionSources)} sources</strong></div><div><span>Stalled partial sources</span><strong>${formatCount(cycle.stalledSources)} sources</strong></div>`
    : `<div><span>Last completed monitor cycle</span><strong>${escapeHtml(cycleTime)}</strong></div><div><span>Cycle backlog state</span><strong>${escapeHtml(cycleState)}</strong></div>`;
  panel.classList.remove('error');
  panel.innerHTML = `<p class="eyebrow">TRACKING STATUS</p><h2>${escapeHtml(label(state))}</h2><div class="tracking-status-details"><div><span>Registered project${names.length === 1 ? '' : 's'}</span><strong>${names.length ? escapeHtml(names.join(' · ')) : 'No registered project available'}</strong></div><div><span>Last successful ingestion</span><strong>${escapeHtml(formatTime(latestIngestionAt))}</strong></div><div><span>Latest source state</span><strong>${escapeHtml(label(state))}</strong></div>${cycleDetails}</div><p>${escapeHtml(trackingStateCopy(state))} The completed-cycle record is historical status only; this page does not indicate whether a monitor is running.</p>`;
}
function gitActivityForProject(name) { return projectGitOverviewData?.projects?.find((record) => record.project?.name === name) || null; }
function gitStateCopy(activity) {
  if (!activity || activity.state === 'unavailable') return 'Unavailable';
  if (activity.state === 'modified') return 'Modified locally';
  if (activity.state === 'clean') return 'Clean working tree';
  if (activity.state === 'available') return formatTime(activity.pushedAt || activity.committedAt);
  if (activity.state === 'up_to_date') return 'Up to date';
  if (activity.state === 'ahead') return `Ahead by ${formatCount(activity.ahead)}`;
  if (activity.state === 'behind') return `Behind by ${formatCount(activity.behind)}`;
  if (activity.state === 'diverged') return `Diverged · ${formatCount(activity.ahead)} ahead / ${formatCount(activity.behind)} behind`;
  return 'Unavailable';
}
function renderGitActivity(projectName, observedAt) {
  const activity = gitActivityForProject(projectName);
  if (!activity) return '<section class="rollout-section git-activity"><h3>Git activity</h3><p class="quiet">Local Git activity is unavailable because this project has no registered repository inspection result.</p></section>';
  const local = activity.localFiles || { state: 'unavailable' };
  const commit = activity.commit || { state: 'unavailable' };
  const push = activity.push || { state: 'unavailable' };
  const relationship = activity.remoteRelationship || { state: 'unavailable' };
  const localTime = local.latestModificationAt ? formatTime(local.latestModificationAt) : 'No local workspace-file timestamp available';
  const commitTime = commit.committedAt ? formatTime(commit.committedAt) : 'No local commit available';
  const pushTime = push.pushedAt ? formatTime(push.pushedAt) : 'No local push record available';
  const commitId = commit.shortCommitId ? ` · ${escapeHtml(commit.shortCommitId)}` : '';
  const observed = observedAt ? `Observed locally ${formatTime(observedAt)}. Refreshes while this dashboard is open are read-only.` : 'No local Git observation time is available.';
  return `<section class="rollout-section git-activity"><h3>Git activity</h3><p class="data-note">${escapeHtml(observed)}</p><div class="git-activity-grid" aria-label="${escapeHtml(projectName)} local Git activity"><div><span>Last local workspace-file change</span><strong>${escapeHtml(localTime)}</strong><small>${escapeHtml(gitStateCopy(local))}</small></div><div><span>Last local commit</span><strong>${escapeHtml(commitTime)}${commitId}</strong><small>Local repository record</small></div><div><span>Last locally recorded push</span><strong>${escapeHtml(pushTime)}</strong><small>${push.state === 'available' ? 'Local reflog evidence only — not GitHub verified' : 'Unavailable unless local reflog explicitly records a push'}</small></div><div><span>Current local/remote relationship</span><strong>${escapeHtml(gitStateCopy(relationship))}</strong><small>Local Git knowledge only — not GitHub verified</small></div></div></section>`;
}
function readinessValue(metric) {
  if (!metric || metric.coveragePercent == null) return 'Unavailable';
  return `${metric.coveragePercent}% (${formatCount(metric.available)}/${formatCount(metric.total)})${metric.conflicting ? ` · ${formatCount(metric.conflicting)} conflicting` : ''}`;
}
function readinessNote(metric, labelName) {
  if (!metric || metric.state === 'not_yet_ingested') return `No eligible response evidence has been ingested for ${labelName.toLowerCase()} yet.`;
  if (metric.state === 'complete') return `Observed for every eligible response in the current local data.`;
  if (metric.state === 'conflicting') return `Conflicting explicit source metadata is treated as unavailable.`;
  if (metric.state === 'partial') return `Only explicit source metadata is counted; missing evidence remains unavailable.`;
  return `The current local source has not supplied usable evidence for this field.`;
}
function renderAttributionReadiness(readiness) {
  const role = readiness?.roleLabels;
  const model = readiness?.runtimeModel;
  const effort = readiness?.reasoningEffort;
  const lifecycle = readiness?.lifecycleCompletionEvidence;
  const modelLabels = (model?.labels || []).map((item) => `${escapeHtml(item.label)} · ${formatCount(item.turnCount)} responses`).join('<br>') || 'No runtime model observed';
  const effortLabels = (effort?.labels || []).map((item) => `${escapeHtml(label(item.label))} · ${formatCount(item.turnCount)} responses`).join('<br>') || 'No reasoning effort observed';
  return `<section class="rollout-section attribution-readiness"><h3>Attribution readiness</h3><p class="data-note">Role, model, and effort coverage use eligible exact responses; lifecycle coverage uses eligible tasks. This is a data-quality check, not an effectiveness score.</p><div class="attribution-grid" aria-label="Attribution readiness"><div><span>Role labels · eligible responses</span><strong>${escapeHtml(readinessValue(role))}</strong><small>${escapeHtml(readinessNote(role, 'role labels'))}</small></div><div><span>Runtime model · eligible responses</span><strong>${escapeHtml(readinessValue(model))}</strong><small>${modelLabels}</small></div><div><span>Reasoning effort · eligible responses</span><strong>${escapeHtml(readinessValue(effort))}</strong><small>${effortLabels}</small></div><div><span>Terminal lifecycle evidence · eligible tasks</span><strong>${escapeHtml(readinessValue(lifecycle))}</strong><small>${escapeHtml(readinessNote(lifecycle, 'terminal lifecycle evidence'))} This does not prove task acceptance or completion.</small></div></div></section>`;
}
function renderRolloutOverview(overview) {
  const empty = document.querySelector('#rollout-empty-state');
  const container = document.querySelector('#rollout-project-list');
  renderTrackingStatus(overview);
  empty.hidden = overview.projects.some((record) => record.sourceHealth || record.tasks.length || record.roles.length);
  if (!overview.projects.length) { container.innerHTML = ''; return; }
  container.innerHTML = overview.projects.map((record) => {
    const health = record.sourceHealth;
    const usage = record.totals.exactResponseUsage;
    const state = trackingState(record);
    const pendingMarkup = health?.pendingBytes > 0 ? `<div><dt>Pending local data</dt><dd>${formatCount(health.pendingBytes)} bytes</dd></div>` : '';
    const healthMarkup = health
      ? `<dl class="health-list"><div><dt>Latest ingestion</dt><dd>${escapeHtml(formatTime(health.latestIngestionAt))}</dd></div><div><dt>Source state</dt><dd>${escapeHtml(label(state))}</dd></div>${pendingMarkup}</dl><p class="data-note">${escapeHtml(trackingStateCopy(state))} This does not indicate whether a monitor is running.</p>`
      : `<p class="quiet">${escapeHtml(trackingStateCopy(state))}</p>`;
    const tasks = record.tasks.length
      ? record.tasks.map((task) => `<tr><td>${escapeHtml(task.taskId)}</td><td>${task.state === 'completed' ? 'Completed' : 'Active / incomplete'}</td><td>${formatCount(task.turnCount)}</td><td>${formatCount(task.exactTokenTotal)}</td><td>${escapeHtml(task.roleLabel)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="quiet">No real rollout tasks were persisted for this project.</td></tr>';
    const roles = record.roles.length
      ? record.roles.map((role) => `<div class="role-row"><strong>${escapeHtml(role.roleLabel)}</strong><span>${formatCount(role.turnCount)} turns · ${formatCount(role.exactTokenTotal)} exact tokens</span></div>`).join('')
      : '<p class="quiet">No project-agent role usage is available yet.</p>';
    return `<article class="panel rollout-project"><div class="panel-heading"><div><p class="eyebrow">REGISTERED PROJECT</p><h2>${escapeHtml(record.project.name)}</h2></div><p class="capture-note">${escapeHtml(label(state))}</p></div>${healthMarkup}${renderGitActivity(record.project.name, projectGitOverviewData?.observedAt)}<section class="metrics rollout-metrics" aria-label="${escapeHtml(record.project.name)} usage summary"><article><span>Active / incomplete</span><strong>${formatCount(record.totals.activeTasks)}</strong></article><article><span>Completed</span><strong>${formatCount(record.totals.completedTasks)}</strong></article><article><span>Exact response usage</span><strong>${formatCount(usage.totalTokens)}</strong><small>${formatCount(usage.inputTokens)} in · ${formatCount(usage.outputTokens)} out</small></article></section>${renderAttributionReadiness(record.attributionReadiness)}<section class="rollout-section"><h3>Tasks — ${escapeHtml(record.project.name)}</h3><table class="rollout-table"><thead><tr><th>Task ID</th><th>State</th><th>Turns</th><th>Exact tokens</th><th>Role</th></tr></thead><tbody>${tasks}</tbody></table><p class="data-note">Active / incomplete means no completion event was observed.</p></section><section class="rollout-section"><h3>Agent / role totals — ${escapeHtml(record.project.name)}</h3>${roles}<p class="data-note">Unknown role means the live source did not provide a child-agent label.</p></section></article>`;
  }).join('');
}
function showRolloutError() { const panel = document.querySelector('#tracking-status-panel'); document.querySelector('#rollout-empty-state').hidden = true; panel.classList.add('error'); panel.innerHTML = '<p class="eyebrow">TRACKING STATUS</p><h2>Local Overview unavailable</h2><p>The local Overview API could not load, so the displayed tracking data cannot be confirmed. Retry only reloads this read-only local view; it does not start ingestion or change stored data.</p><button id="rollout-retry" class="quiet-button" type="button">Retry</button>'; document.querySelector('#rollout-project-list').innerHTML = ''; document.querySelector('#rollout-retry').addEventListener('click', () => { void loadRolloutOverview(); }); }
function loadRolloutOverview() {
  if (rolloutRefreshPromise) return rolloutRefreshPromise;
  rolloutRefreshPromise = (async () => {
    try { const response = await fetch('/api/rollout-overview'); if (!response.ok) throw new Error('Rollout overview request failed.'); rolloutOverviewData = await response.json(); renderRolloutOverview(rolloutOverviewData); } catch { showRolloutError(); } finally { rolloutRefreshPromise = null; }
  })();
  return rolloutRefreshPromise;
}
function loadProjectGitOverview() {
  if (projectGitRefreshPromise) return projectGitRefreshPromise;
  projectGitRefreshPromise = (async () => {
    try {
      const response = await fetch('/api/project-overview');
      if (!response.ok) throw new Error('Project Git overview request failed.');
      projectGitOverviewData = await response.json();
    } catch {
      projectGitOverviewData = { projects: [] };
    } finally {
      projectGitRefreshPromise = null;
    }
    if (rolloutOverviewData) renderRolloutOverview(rolloutOverviewData);
  })();
  return projectGitRefreshPromise;
}
function refreshProjectOverview() { return Promise.all([loadRolloutOverview(), loadProjectGitOverview()]); }
function startOverviewAutoRefresh() { return setInterval(() => { void refreshProjectOverview(); }, ROLLOUT_REFRESH_INTERVAL_MS); }
async function loadDashboard() { const parameters = new URLSearchParams(); filters.forEach((name) => { const value = document.querySelector(`#${name}-filter`).value; if (value) parameters.set(name, value); }); const response = await fetch(`/api/overview?${parameters}`); if (!response.ok) throw new Error('Unable to load local dashboard data.'); dashboardData = await response.json(); populateFilter('project', dashboardData.filters.projects); populateFilter('workstream', dashboardData.filters.workstreams); populateFilter('status', dashboardData.filters.statuses); populateCaptureForm(dashboardData.filters); setStartedAtDefault(); renderWorkstreams(dashboardData.summary.workstreams); renderAgents(dashboardData.agents); renderTasks(dashboardData.events); await loadRolloutOverview(); await loadProjectGitOverview(); }
function showPage(page, workView) { document.querySelectorAll('[data-page-content]').forEach((item) => item.classList.toggle('active', item.dataset.pageContent === page)); document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page)); const [eyebrow, title, description] = pageCopy[page]; document.querySelector('#page-eyebrow').textContent = eyebrow; document.querySelector('#page-title').textContent = title; document.querySelector('#page-description').textContent = description; if (page === 'work') showWorkView(workView || 'record'); window.location.hash = page; }
function showWorkView(view) { document.querySelectorAll('[data-work-content]').forEach((item) => item.classList.toggle('active', item.dataset.workContent === view)); document.querySelectorAll('.subnav-item').forEach((item) => item.classList.toggle('active', item.dataset.workView === view)); }
function lines(id) { return document.querySelector(`#${id}`).value.split('\n').map((value) => value.trim()).filter(Boolean); }
function toIso(id) { const value = document.querySelector(`#${id}`).value; return value ? new Date(value).toISOString() : null; }
async function submitTask(event) { event.preventDefault(); const profile = activeProfile(); if (!profile) throw new Error('Select an agent profile before recording this task.'); const message = document.querySelector('#form-message'); const status = document.querySelector('#form-status').value; const candidate = { task: { id: `local-${crypto.randomUUID()}`, title: document.querySelector('#task-title').value.trim(), project: document.querySelector('#form-project').value, workstream: document.querySelector('#form-workstream').value }, assignment: { agentId: profile.agent_id, role: profile.role }, execution: { agent: profile.display_name, runtime: document.querySelector('#runtime').value, model: document.querySelector('#model').value || null, startedAt: toIso('started-at'), completedAt: status === 'completed' ? new Date().toISOString() : null, status }, outcome: { result: document.querySelector('#outcome').value, retryCount: Number(document.querySelector('#retry-count').value), blocker: document.querySelector('#blocker').value.trim() || null, validation: lines('validation') }, references: { repository: document.querySelector('#repository').value.trim() || null, branch: document.querySelector('#branch').value.trim() || null, commit: document.querySelector('#commit').value.trim() || null, changedFiles: lines('changed-files') } }; message.textContent = 'Recording task…'; const response = await fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) }); if (!response.ok) throw new Error('Unable to record this task. Check required fields and avoid private content.'); resetCaptureForm(); message.textContent = 'Task recorded locally.'; await loadDashboard(); }
async function submitAgent(event) { event.preventDefault(); const message = document.querySelector('#agent-message'); const candidate = { displayName: document.querySelector('#agent-name').value.trim(), project: document.querySelector('#agent-project').value, role: document.querySelector('#agent-role').value.trim(), runtime: document.querySelector('#agent-runtime').value, defaultModel: document.querySelector('#agent-model').value || null }; message.textContent = 'Adding agent…'; const response = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) }); if (!response.ok) throw new Error('Unable to add this agent. Check the required fields.'); const { agent } = await response.json(); document.querySelector('#agent-form').reset(); message.textContent = 'Agent profile added.'; await loadDashboard(); document.querySelector('#form-project').value = agent.project; populateAgentProfiles(agent.agent_id); }
function showError() { document.querySelector('#page-description').textContent = 'The dashboard could not load the local tracker database.'; }
document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page, button.dataset.workView)));
document.querySelectorAll('.subnav-item').forEach((button) => button.addEventListener('click', () => showWorkView(button.dataset.workView)));
filters.forEach((name) => document.querySelector(`#${name}-filter`).addEventListener('change', () => loadDashboard().catch(showError)));
document.querySelector('#clear-filters').addEventListener('click', () => { filters.forEach((name) => { document.querySelector(`#${name}-filter`).value = ''; }); loadDashboard().catch(showError); });
document.querySelector('#form-project').addEventListener('change', () => populateAgentProfiles()); document.querySelector('#agent-profile').addEventListener('change', updateActiveProfile); document.querySelector('#runtime').addEventListener('change', () => populateModels('model', document.querySelector('#runtime').value)); document.querySelector('#agent-runtime').addEventListener('change', () => populateModels('agent-model', document.querySelector('#agent-runtime').value)); document.querySelector('#task-form').addEventListener('submit', (event) => submitTask(event).catch((error) => { document.querySelector('#form-message').textContent = error.message; })); document.querySelector('#agent-form').addEventListener('submit', (event) => submitAgent(event).catch((error) => { document.querySelector('#agent-message').textContent = error.message; }));
loadDashboard().then(() => { const initialPage = location.hash.slice(1); if (pageCopy[initialPage]) showPage(initialPage); startOverviewAutoRefresh(); }).catch(showError);
