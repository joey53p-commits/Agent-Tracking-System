# Local dashboard

Run the dashboard from the repository root:

```powershell
npm run dashboard
```

Open `http://127.0.0.1:4173` in a browser on the same computer. The server binds only to `127.0.0.1` and exposes a small local API for the dashboard interface; it does not serve the SQLite database file or bind to the network.

Starting the dashboard never starts, schedules, or retains a rollout monitor.
It only reads persisted local data unless you deliberately use a separate
manual task-recording form. Collection has separate explicit commands:
`npm run monitor:once` for one bounded cycle and `npm run monitor:continuous`
for continuous polling. `npm run monitor` stops with an instruction instead of
choosing a collection mode for you.

The rollout Overview re-reads `GET /api/rollout-overview` every 15 seconds.
That browser refresh only reads: it never discovers a rollout, starts
ingestion, or sends a write request. The displayed time is the latest
successful local ingestion transaction available through the API, so the view
reflects the last committed local state and does not prove that the monitor is
currently running.

The **Overview** begins with a Tracking status panel. It names every registered
project, shows the latest successful local ingestion time and the worst current
source state (`caught up`, `partial`, or `not yet ingested`), and explains what
the state means. If the local Overview API cannot load, it shows `unavailable`
with a Retry control that repeats only the read-only API request. It never
claims that a monitor is running.

The **Overview** is the Stage 5 read-only rollout view. It shows only persisted,
allowlisted aggregates: registered project name, the latest source-health
snapshot, project-agent task counts, exact response-level token usage, task
state and turn totals, and role totals. A source-health-only ingestion remains
visible with zero tasks instead of being mistaken for an empty database. System
guardian activity is excluded from the project-agent task, turn, role, and usage
totals. Project health combines the newest observation for every known source:
any partial or stale source remains visible instead of being masked by a later
healthy source. Freshness describes source age at the recorded ingestion
snapshot; it does not claim that collection is currently running.

The **Work** views contain the reviewed task-event workflow: recording work,
active or interrupted tasks, task history, filters, and workstream progress.
Project, workstream, and status filters update the task list without changing
stored data. The pilot catalog makes every filter usable before task events
exist, and recorded projects or workstreams are added automatically. A failure
of the rollout aggregate does not prevent these task-event views from loading.

## Recording pilot tasks

Use the **Record agent work** form at the top of the dashboard to create a local task event. It accepts task metadata, status, outcome, retries, validation evidence, and optional safe repository references. The form uses the same privacy gate as the collector and rejects prompts, transcripts, credentials, secrets, and raw command output before any database write.
