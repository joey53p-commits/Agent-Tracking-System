const filters = ['project', 'workstream', 'status'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function label(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function populateFilter(name, values) {
  const select = document.querySelector(`#${name}-filter`);
  const selected = select.value;
  select.innerHTML = `<option value="">All ${name === 'status' ? 'statuses' : `${name}s`}</option>`;
  values.forEach((value) => {
    const option = new Option(label(value), value, false, value === selected);
    select.add(option);
  });
}

function populateSelect(id, values, selectedValue) {
  const select = document.querySelector(`#${id}`);
  const selected = selectedValue ?? select.value;
  select.innerHTML = '';
  values.forEach((value) => select.add(new Option(label(value), value, false, value === selected)));
}

function populateCaptureForm(catalog) {
  populateSelect('form-project', catalog.projects, document.querySelector('#form-project').value || 'Rise');
  populateSelect('form-workstream', catalog.workstreams, document.querySelector('#form-workstream').value || 'Quality Assurance');
  populateSelect('form-status', catalog.statuses, document.querySelector('#form-status').value || 'completed');
  populateSelect('outcome', ['accepted', 'needs_review', 'reworked', 'not_applicable', 'unknown'], document.querySelector('#outcome').value || 'accepted');
}

function setStartedAtDefault() {
  const input = document.querySelector('#started-at');
  if (!input.value) input.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function resetCaptureForm() {
  document.querySelector('#task-form').reset();
  document.querySelector('#form-project').value = 'Rise';
  document.querySelector('#form-workstream').value = 'Quality Assurance';
  document.querySelector('#form-status').value = 'completed';
  document.querySelector('#outcome').value = 'accepted';
  setStartedAtDefault();
}

function renderMetrics(totals) {
  document.querySelector('#total-tasks').textContent = totals.totalTasks || 0;
  document.querySelector('#completed-tasks').textContent = totals.completedTasks || 0;
  document.querySelector('#interrupted-tasks').textContent = totals.interruptedTasks || 0;
  document.querySelector('#retries').textContent = totals.retries || 0;
}

function renderWorkstreams(workstreams) {
  const container = document.querySelector('#workstreams');
  container.innerHTML = workstreams.length ? workstreams.map((workstream) => `
    <div class="workstream-row">
      <div><strong>${escapeHtml(workstream.workstream)}</strong><span>${escapeHtml(workstream.project)}</span></div>
      <div><strong>${workstream.completedCount}/${workstream.taskCount}</strong><span>completed</span></div>
    </div>`).join('') : '<p class="quiet">Workstream summaries appear after the first task is recorded.</p>';
}

function renderTasks(events) {
  const hasActiveFilter = filters.some((name) => document.querySelector(`#${name}-filter`).value);
  document.querySelector('#task-count').textContent = `${events.length} shown`;
  document.querySelector('#empty-state').hidden = events.length > 0;
  document.querySelector('#empty-state h3').textContent = hasActiveFilter ? 'No tasks match these filters' : 'No tasks recorded yet';
  document.querySelector('#empty-state p').textContent = hasActiveFilter
    ? 'Try a different filter combination, or clear the filters to review all recorded work.'
    : 'Use the collector to add a reviewed task event. It will appear here immediately.';
  document.querySelector('#task-list').innerHTML = events.map((event) => `
    <article class="task-card">
      <div class="task-main"><div class="task-title-row"><h3>${escapeHtml(event.task_title)}</h3><span class="status ${escapeHtml(event.execution_status)}">${label(event.execution_status)}</span></div>
      <p>${escapeHtml(event.project)} · ${escapeHtml(event.workstream)} · ${escapeHtml(event.agent)}${event.model ? ` · ${escapeHtml(event.model)}` : ''}</p>
      <div class="evidence">${event.validation.length ? event.validation.map((item) => `<span>${escapeHtml(item)}</span>`).join('') : '<span>No validation recorded</span>'}</div></div>
      <div class="task-meta"><strong>${label(event.outcome_result)}</strong><span>${event.retry_count} retries</span></div>
    </article>`).join('');
}

async function loadDashboard() {
  const parameters = new URLSearchParams();
  filters.forEach((name) => {
    const value = document.querySelector(`#${name}-filter`).value;
    if (value) parameters.set(name, value);
  });
  const response = await fetch(`/api/overview?${parameters}`);
  if (!response.ok) throw new Error('Unable to load local dashboard data.');
  const data = await response.json();
  populateFilter('project', data.filters.projects);
  populateFilter('workstream', data.filters.workstreams);
  populateFilter('status', data.filters.statuses);
  populateCaptureForm(data.filters);
  setStartedAtDefault();
  renderMetrics(data.summary.totals);
  renderWorkstreams(data.summary.workstreams);
  renderTasks(data.events);
}

filters.forEach((name) => document.querySelector(`#${name}-filter`).addEventListener('change', () => loadDashboard().catch(showError)));
document.querySelector('#clear-filters').addEventListener('click', () => {
  filters.forEach((name) => { document.querySelector(`#${name}-filter`).value = ''; });
  loadDashboard().catch(showError);
});

function lines(id) {
  return document.querySelector(`#${id}`).value.split('\n').map((value) => value.trim()).filter(Boolean);
}

function toIso(id) {
  const value = document.querySelector(`#${id}`).value;
  return value ? new Date(value).toISOString() : null;
}

async function submitTask(event) {
  event.preventDefault();
  const message = document.querySelector('#form-message');
  const status = document.querySelector('#form-status').value;
  const candidate = {
    task: {
      id: `local-${crypto.randomUUID()}`,
      title: document.querySelector('#task-title').value.trim(),
      project: document.querySelector('#form-project').value,
      workstream: document.querySelector('#form-workstream').value,
    },
    execution: {
      agent: document.querySelector('#agent').value.trim(),
      model: document.querySelector('#model').value.trim() || null,
      startedAt: toIso('started-at'),
      completedAt: status === 'completed' ? new Date().toISOString() : null,
      status,
    },
    outcome: {
      result: document.querySelector('#outcome').value,
      retryCount: Number(document.querySelector('#retry-count').value),
      blocker: document.querySelector('#blocker').value.trim() || null,
      validation: lines('validation'),
    },
    references: {
      repository: document.querySelector('#repository').value.trim() || null,
      branch: document.querySelector('#branch').value.trim() || null,
      commit: document.querySelector('#commit').value.trim() || null,
      changedFiles: lines('changed-files'),
    },
  };
  message.textContent = 'Recording task…';
  const response = await fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) });
  if (!response.ok) throw new Error('Unable to record this task. Check required fields and avoid private content.');
  resetCaptureForm();
  message.textContent = 'Task recorded locally.';
  await loadDashboard();
}

document.querySelector('#task-form').addEventListener('submit', (event) => submitTask(event).catch((error) => {
  document.querySelector('#form-message').textContent = error.message;
}));

function showError() {
  document.querySelector('#task-list').innerHTML = '<p class="error">The dashboard could not load the local tracker database.</p>';
}

loadDashboard().catch(showError);
