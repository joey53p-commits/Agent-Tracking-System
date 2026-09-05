const { statuses } = require('../../packages/event-schema');

// The pilot catalog keeps filters useful before the first task is collected.
// Recorded events are merged into these options rather than restricted by them.
const pilotCatalog = {
  projects: ['Rise', 'Agent Tracking System'],
  workstreams: [
    'Product & Planning',
    'Mobile UI & Design System',
    'Workout Experience',
    'Data & Backend',
    'Quality Assurance',
    'Release & Infrastructure',
    'Marketing & Growth',
  ],
  statuses: [...statuses],
};

function mergeCatalogValues(defaultValues, eventValues) {
  return [...new Set([...defaultValues, ...eventValues.filter(Boolean)])].sort();
}

function getFilterCatalog(events) {
  return {
    projects: mergeCatalogValues(pilotCatalog.projects, events.map((event) => event.project)),
    workstreams: mergeCatalogValues(pilotCatalog.workstreams, events.map((event) => event.workstream)),
    statuses: mergeCatalogValues(pilotCatalog.statuses, events.map((event) => event.execution_status)),
  };
}

module.exports = { getFilterCatalog, pilotCatalog };
