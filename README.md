# Agent Tracking System

A private, local-first system for understanding how coding agents support Rise.

It records work at the task level: the project, workstream, model or agent,
timing, result, validation evidence, retries, and blockers. It is deliberately
separate from the Rise product repository so monitoring code and product code
can evolve and be released independently.

## Start here

1. Read [the data contract](docs/data-contract.md) and [privacy rules](docs/privacy.md).
2. Review [the pilot measurement plan](docs/measurement-plan.md).
3. Use `node apps/collector/collect.js --input examples/rise-task-event.json --dry-run` to validate a safe event.
4. Store normalized events in the local SQLite database under `data/` (ignored by Git).
5. Build dashboard and reporting code under `apps/dashboard/`.

## Scope

The first milestone is a local dashboard fed by reviewed task-event exports.
Automated integrations with GitHub and Codex come only after the event schema,
redaction, and retention policy have been tested with real Rise work.

## Repository layout

```text
apps/
  collector/       import and redaction adapters
  dashboard/       local reporting interface
docs/              architecture, data and privacy decisions
packages/
  event-schema/    shared event types and validation
data/              local database and exports; never committed
```

## Guardrails

- Do not collect API keys, access tokens, credentials, or `.env` content.
- Do not collect raw prompts or tool output unless specifically approved and
  redacted for a defined purpose.
- Treat task names, file paths, commit references, test outcomes, and elapsed
  time as the initial collection boundary.
- Keep the GitHub repository private while the system contains work metadata.
