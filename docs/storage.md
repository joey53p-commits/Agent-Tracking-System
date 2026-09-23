# Local task-event database

The collector records approved events in `data/agent-tracking.sqlite` using SQLite. The database is local, ignored by Git, and remains inside this repository's `data/` directory. The collector's privacy gate runs before any database write.

The `task_events` table stores one immutable row for each recorded event. It indexes project/workstream, status, and record time so the future dashboard can query task status, reliability, and cycle-time trends efficiently.

The schema is intentionally small during the pilot. A future migration can add approved task-outcome review without storing raw prompts, transcripts, source code, or credentials.

## Stage 4 rollout ingestion

The local database also keeps separate rollout task, turn, source-health, and
checkpoint tables. A turn is inserted once using its source-qualified response
ID; only a successful insert increments its task's exact response-usage totals.
The checkpoint and health observation are committed in the same SQLite
transaction, so a failed transaction neither leaves a partial turn nor advances
the watermark.

Rollout records persist project ID/name, opaque source-file hash, source-qualified
IDs, safe role classification, active/completed status, exact response token
counts, and safe health counters. Project paths are used only while resolving
the registered observer project and are never written. Raw rollouts, paths,
prompts, messages, reasoning, tool data, commands, code, diffs, transcripts,
and thread/session totals are rejected before database writes. The backend
exposes a read-only allowlisted aggregate at `GET /api/rollout-overview` for
the local Overview. It does not expose durable raw-row shapes or
source/session/turn/response identifiers.

## Attribution-readiness storage

`rollout_turn_attribution` stores only a project ID, one-way turn
correlation hash, validated runtime model ID, allowed reasoning-effort label,
their availability/conflict state, and observation timestamp. It has no raw
turn ID, metadata payload, source path, prompt, or source content. Overview
queries join this table only to compute project-level response coverage and
safe label counts.

## Stage 6 monitor writes

The monitor does not introduce another storage path. Every eligible source is
passed to the existing rollout ingestion function, so its turns, task totals,
source-health observation, and checkpoint still commit or roll back together.
Repeated polls rely on the same response-ID primary key and checkpoint records;
they do not create duplicate usage. The monitor serializes its cycles in the
process and uses an atomic lock beside the selected local database so a second
monitor process cannot enter a competing write cycle. The lock contains only
process/ownership metadata and is removed by its owner; a dead-process lock can
be recovered safely. SQLite `BEGIN IMMEDIATE` continues to serialize each
durable batch. A failed or unreadable attributed source is isolated from the
remaining sources and persists only safe partial-health counters. If a source
cannot be read well enough to attribute it to a registered project, only the
aggregate cycle-health counter records the failure.
