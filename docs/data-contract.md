# Task event contract

The collector normalizes every source into an append-only task event.

```json
{
  "eventVersion": 1,
  "eventId": "uuid",
  "recordedAt": "2026-09-05T18:30:00Z",
  "task": { "id": "source-task-id", "title": "Short, safe title", "project": "Rise", "workstream": "mobile-ui" },
  "execution": { "agent": "Codex", "model": "optional-model-id", "startedAt": "2026-09-05T18:00:00Z", "completedAt": "2026-09-05T18:25:00Z", "status": "completed" },
  "outcome": { "result": "accepted", "retryCount": 0, "blocker": null, "validation": ["expo export passed"] },
  "references": { "repository": "rise-redesign", "branch": "codex/redesign-experiment", "commit": "optional-short-sha" }
}
```

Execution statuses: `queued`, `in_progress`, `waiting_for_approval`, `blocked`, `failed`, `cancelled`, and `completed`.

## Stage 3A rollout task, turn, and usage contract

`packages/rollout-normalizer` is an in-memory normalizer only. It does not read
the lifecycle spool, write SQLite, or supply dashboard data. A future adapter may
provide one safe response record with opaque `source`, `taskId`, `sessionId`,
`turnId`, `responseId`, task status, safe agent label, and exact integer input,
output, and total token counts. All emitted IDs are source-qualified; a response
is accepted once per source-qualified response ID.

Each accepted response produces one turn. A task total is the sum of only that
task's accepted turns; it is never derived from a session or thread total. A
completed task freezes its exact accumulated total, while an active task emits
`isComplete: false`. Agent totals are a separate later aggregate over normalized
turns. System guardians are classified through the agent registry and are kept
in a separate aggregate, excluded from project-agent totals.

The normalizer rejects prompt, message, reasoning, tool, command, code, diff,
transcript, raw, path, and session/thread-total fields. An agent path is accepted
only transiently inside the `agent` input object for registry classification and
is not emitted in a normalized turn or aggregate.

## Stage 3B local rollout adapter

`packages/rollout-adapter` reads recent local rollout bytes in memory and emits
only Stage 3A normalized turns/tasks plus a source-health report. The observed
Codex `token_usage_record` shape supplies `thread_id` (task), `session_id`,
`turn_id`, `response_id`, and a response-level `usage` object. The adapter uses
only `usage.input_tokens`, `usage.output_tokens`, and `usage.total_tokens` when
all are exact non-negative integers and total equals input plus output. It never
reads `turn_token_usage` or `thread_token_usage` as task usage.

The adapter resumes from a durable byte-offset checkpoint; offsets are UTF-8
byte positions, never JavaScript character positions. A new source is
read from byte zero in bounded chunks because Codex rollout files are multi-line
object streams rather than line-valid JSONL. Its report contains counts, schema
observations, freshness, and byte count—not file paths, raw records, or source
content. Agent labels are
optional safe adapter context and are classified by the Stage 2.5 registry;
source records observed so far do not expose a child-agent label beside response
usage, so unlabelled turns remain honestly `unknown`.

## Stage 4 durable rollout records

The ingestion CLI is `node apps/collector/ingest-rollout.js --rollout
path/to/rollout.jsonl`; `--dry-run` performs project attribution and adaptation
without writing SQLite. It reuses the observer's registered-project resolver on
the rollout's transient session working directory. Only the resolved project ID
and name are persisted. The source is represented by a one-way hash of its
opaque rollout session ID, not a path.

Every durable turn declares `usage_kind: response_exact`. The database does not
accept cumulative session/thread totals, and it records active status when the
source does not provide completion. Checkpoints, response-ID idempotency, task
totals, and health observations share the same transaction boundary. Each run
uses bounded read buffers and a bounded overlong-envelope scan; an
`overlongPending` partial health state means the source needs a later retry
before the durable checkpoint can safely advance.

## Controlled lifecycle-linkage pilot

`packages/lifecycle-adapter` reads only the atomic local hook spool. It accepts
the recorder's allowlisted event shape, rejects private fields, and stores a
project-scoped one-way correlation hash for the canonical rollout session/turn.
The event ID, observed spool count, opaque spool-file hashes, cursor hash, and
bounded scan backlog state are committed atomically. A bounded scan chooses only
previously unvisited eligible files in cursor order, wrapping at the lexical
tail; therefore a new earlier file is scanned before a caught-up state can be
reported. `Stop`,
`Interrupt`, and `SessionEnd` are lifecycle evidence only: they never imply task
completion or alter exact usage totals.

Run `node apps/collector/ingest-lifecycle.js --dry-run` to inspect the local
spool, then omit `--dry-run` to commit accepted lifecycle evidence.

## Stage 5 read-only rollout Overview

The local dashboard consumes `GET /api/rollout-overview`, an allowlisted
aggregate projection of durable rollout tables plus safe registered-project
names from the existing local observer configuration. It returns registered project
name; latest ingestion time; caught-up/partial state and meaningful pending
bytes; active/completed counts; exact response-level project-agent usage;
task IDs with state, turn count, exact token total and role label; and role
totals. It never returns raw rollout rows or source/session/turn/response IDs,
source hashes, checkpoints, schema observations, paths, or content fields.
Freshness is the source age recorded during that ingestion snapshot, not proof
that ingestion is currently running.

A configured project with no saved rollout record remains visible with no
ingestion snapshot. The dashboard labels that state `not_yet_ingested`; it does
not create a record, inspect project paths, or claim that collection is running.

`Exact response usage` includes only `response_exact` turns counted in project
totals. It is never calculated from session or thread totals. A task remains
`active_incomplete` when no completion event was observed. `Unknown role` is a
source fact: the live source did not provide a child-agent label; the dashboard
does not infer one from identifiers or task content.

## Stage 6 automatic local rollout monitoring

`npm run monitor:continuous` starts a local process that discovers
`rollout-*.jsonl` files below the configured Codex sessions directory,
attributes each source by its transient session working directory, and sends
only registered sources through the existing Stage 4 ingestion function.
`npm run monitor:once` runs the same discovery and ingestion logic once for
testing or an explicit refresh. `npm run monitor` fails closed and requires one
of those modes; it cannot silently start continuous polling.

The default poll interval is 30 seconds and can be changed with
`--interval-ms`; values below one second are clamped to one second. An atomic
database-scoped local lock prevents separate monitor processes from entering
write cycles at the same time; an in-process guard also skips overlapping timer
cycles. Each eligible source retains the existing SQLite transaction,
checkpoint, and response-ID deduplication boundaries.
Malformed or growing attributed sources produce partial source health;
discovery/read failures are counted as unavailable for the cycle. One source
failure does not stop other eligible sources. Shutdown clears future polling
and waits for the active cycle to finish. The adapter checks file size again
after reading, so bytes appended during a cycle stay pending instead of being
reported as caught up. Dashboard health aggregates the newest observation per
source and surfaces the worst freshness/read state across those sources.

The browser separately re-reads the existing allowlisted aggregate every 15
seconds. It does not share monitor authority and cannot ingest or write rollout
data. No hook, Task Scheduler entry, Windows service, cloud storage, scoring,
or product-application integration is part of Stage 6.
