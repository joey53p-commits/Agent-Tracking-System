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
  renderMetrics(data.summary.totals);
  renderWorkstreams(data.summary.workstreams);
  renderTasks(data.events);
}

filters.forEach((name) => document.querySelector(`#${name}-filter`).addEventListener('change', () => loadDashboard().catch(showError)));
document.querySelector('#clear-filters').addEventListener('click', () => {
  filters.forEach((name) => { document.querySelector(`#${name}-filter`).value = ''; });
  loadDashboard().catch(showError);
});

function showError() {
  document.querySelector('#task-list').innerHTML = '<p class="error">The dashboard could not load the local tracker database.</p>';
}

loadDashboard().catch(showError);
