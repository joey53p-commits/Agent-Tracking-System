# Privacy and retention rules

## Pilot collection

Collect task identifiers, safe titles, project/workstream, timestamps, status, agent/model label, retry count, approval waits, validation names, and Git references.

For approved local rollout ingestion, collect only source-qualified task/session/turn/response identifiers, registered project ID/name, safe role classification, active/completed state, exact response-level input/output/total token counts, an opaque source-file hash, checkpoint offsets, and source-health counters/freshness. Agent paths are transient classification input only and are not retained.

When an explicit rollout `turn_context` record supplies them, the tracker may
retain a constrained runtime model ID and an allowed reasoning-effort label
against a one-way turn correlation hash. Missing, malformed, or conflicting
values remain unavailable. Profile defaults and task content are never used to
fill those fields.

## Excluded by default

Never collect access tokens, API keys, passwords, cookies, environment files, personal data, raw prompts, full tool output, source code, screenshots, or transcripts.

Never retain rollout lines, working-directory/project paths, messages, reasoning tokens or content, tool data, commands, code, diffs, cumulative session/thread usage, or source-file paths. If exact response-level usage is absent, record its unavailability in source health rather than estimating it.

Lifecycle linkage accepts only allowlisted hook metadata and persists its event
state, registered project ID/name, safe registry role, timestamp, one-way
correlation hashes, and an opaque spool-cursor hash with aggregate backlog
counts. It never retains a hook path or spool filename, prompt, message,
transcript, raw spool record, agent ID, tool data, command, code, or diff.

Keep raw imports only long enough to normalize and audit an event. Before adding cloud storage, define retention, deletion, and access rules.

## Dashboard projection

The rollout Overview is read-only and local-only. Its API exposes an allowlist
of aggregate task, role, exact response-usage, and source-health fields. It
does not expose raw rollout records, source/session/turn/response identifiers,
source hashes, checkpoint details, schema observations, project paths, prompts,
messages, reasoning, tools, commands, code, diffs, transcripts, or cumulative
session/thread totals.

Attribution readiness adds only aggregate coverage counts/states and validated
model/effort label counts. It never exposes session correlations or metadata
records, and terminal lifecycle evidence is explicitly not presented as task
acceptance or completion.

The Stage 6 monitor scans only the local Codex sessions directory supplied to
the process. File paths and session working directories are transient inputs to
discovery and registered-project attribution; they are never added to dashboard
responses or stored as source health. Unregistered sources are ignored. Cycle
reports contain counts and health states only, not source paths or raw errors.
The monitor does not contact a remote collector or alter user-level Codex
configuration.

Dashboard startup has no monitor dependency and does not begin collection. A
one-time local cycle requires `npm run monitor:once`; continuous polling
requires `npm run monitor:continuous`. The unqualified `npm run monitor`
command fails closed rather than choosing a collection mode.

The project Git-activity projection reads only repositories already listed in
the existing registered-project configuration. It exposes derived timestamps,
a safe short commit ID, working-tree state, local-reflog push evidence, and
local ahead/behind counts. It does not expose or persist repository paths,
remote URLs/names, branch names, file names, commit messages/authors, diffs, or
source content. Git inspection is local-only and does not fetch, pull, push, or
contact a hosting provider.
