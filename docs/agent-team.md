# Agent Tracking System team

## Roles

The delivery team is deliberately small. Profiles are invoked only when their
work adds value; they are not persistent workers.

| Role | Owns | Runtime |
| --- | --- | --- |
| Primary Manager / Integrator | Scope, sequencing, architecture, delegation, integration, acceptance, and user communication | `gpt-6-sol` / `medium` |
| Builder | Database, ingestion, APIs, dashboard, tests, and documentation | `gpt-6-sol` / `medium` |
| Data & Trust Reviewer | Independent read-only review of metrics, contracts, privacy, security, correctness, and evidence | `gpt-6-sol` / `medium` |
| Scout | Bounded read-only discovery, inventories, and execution tracing | `gpt-6-luna` / `low` |

`gpt-6-astra` / `high` is reserved for explicit high-consequence escalation,
not configured as a standing agent.

## Operating pattern

The manager works alone for planning, explanation, support, and trivial changes.
Meaningful implementation goes to the builder. Material changes receive a
separate data/trust review after implementation. The scout is used only when a
bounded investigation has enough independent value to justify another agent.

One agent owns each file or shared contract at a time. Builder and reviewer work
sequentially unless the manager identifies genuinely independent boundaries.
Every handoff includes the result, files changed, validation evidence, privacy
or data impact, and unresolved risks.

## Team evolution

Add a new role only when repeated work demonstrates a durable responsibility
that cannot be handled clearly by the builder or reviewer. Split the builder
into frontend and backend roles only when concurrent work repeatedly requires
separate, non-overlapping ownership.
