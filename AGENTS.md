# Agent Tracking System — Team Operating Rules

## Mission

Build a private, local-first system for understanding coding-agent work without
collecting prompts, source code, credentials, or raw tool output by default.

## Team and routing

The active chat is the **Foundation & Architecture** lead. It owns scope,
cross-cutting decisions, integration order, and final acceptance.

Route work to one primary owner:

| Work | Primary owner | Required partner when material |
| --- | --- | --- |
| Architecture, delivery sequencing, cross-cutting changes | Foundation & Architecture | QA, Security & Pilot Review |
| Telemetry, import adapters, redaction, retention | Telemetry, Privacy & Data Collection | Backend, Database & Integrations; QA, Security & Pilot Review |
| Metric definitions, role registry, outcomes, model evaluation | Metrics, Roles & Evaluation | Dashboard UX & Frontend |
| Database schema, ingestion, APIs, Git/CI adapters | Backend, Database & Integrations | Telemetry, Privacy & Data Collection |
| Dashboard interface and local interaction design | Dashboard UX & Frontend | Metrics, Roles & Evaluation |
| Tests, privacy review, security review, pilot gates | QA, Security & Pilot Review | Owner of the reviewed work |

Do not give two agents concurrent write ownership of the same files. Split
independent work by directory or wait for a completed handoff before editing
shared schema, storage, or dashboard files.

## Delegation policy

Use parallel agents only when the work is independent and the expected quality
or speed benefit is meaningful. Prefer one agent for focused changes. For broad
changes, delegate discovery or review in parallel, then let one named owner
integrate the resulting edits. Each subtask must state its deliverable,
non-goals, validation required, and files or boundaries it owns.

Before delegating material work, follow `docs/manager-launch-protocol.md`.
Foundation & Architecture is the Delivery Manager and Integrator; it selects
the owner, review gate, task class, and whether work is parallel or sequenced.

Use the project-local custom agent profiles in `.codex/agents/` and follow
`docs/model-routing.md`. Terra medium is the delivery-team default; Luna low is
for bounded support work. Sol medium and Astra high are explicit escalations,
not role defaults. Do not infer cost, quota usage, or model quality from
incomplete telemetry.

## Required safety boundaries

- Keep the dashboard local-first and bound local services to `127.0.0.1`.
- Never enable user-level Codex telemetry, alter `~/.codex` configuration, or
  contact a remote collector without explicit user approval.
- Exclude credentials, `.env` contents, prompt text, source code, transcripts,
  and raw tool arguments/output from stored records unless the user explicitly
  approves a redacted, documented exception.
- Treat external repositories as read-only evidence sources unless the user
  explicitly asks to modify them.
- Preserve unrelated work and avoid destructive Git commands.

## Delivery protocol

1. Inspect the relevant source, tests, and documentation before proposing edits.
2. Update the architecture, data contract, privacy policy, or measurement plan
   when behavior or a measurement definition changes.
3. Add focused automated tests for new behavior and run the relevant checks.
4. Report the files changed, validation evidence, privacy impact, and any
   remaining limitation or follow-up.

The source of truth for the full role charter is `docs/agent-team.md`.
