# Agent Tracking System

A private, local-first system for understanding how coding agents support Rise.

It records work at the task level: the project, workstream, model or agent,
timing, result, validation evidence, retries, and blockers. It is deliberately
separate from the Rise product repository so monitoring code and product code
can evolve and be released independently.

## Start here

1. Read [the data contract](docs/data-contract.md) and [privacy rules](docs/privacy.md).
2. Review [the pilot measurement plan](docs/measurement-plan.md).
3. Read [the agent-team charter](docs/agent-team.md) before delegating or changing a cross-cutting component.
4. Use the [Manager Launch Protocol](docs/manager-launch-protocol.md) before delegating material work.
5. Use [model routing](docs/model-routing.md) to select the task's model and effort.
6. Use `node apps/collector/collect.js --input examples/rise-task-event.json --dry-run` to validate a safe event.
7. Store normalized events in the local SQLite database under `data/` (ignored by Git).
8. Start the local dashboard with `npm run dashboard`, then open `http://127.0.0.1:4173`. This only serves already-stored local data.
9. Choose collection deliberately: run one safe discovery/ingestion cycle with `npm run monitor:once`, or begin continuous local polling only with `npm run monitor:continuous`.

## Scope

The first milestone is a local dashboard fed by reviewed task-event exports.
Automated integrations with GitHub and Codex come only after the event schema,
redaction, and retention policy have been tested with real Rise work.

The Stage 6 rollout monitor remains an explicitly started local process. It
polls local Codex rollout storage every 30 seconds by default, attributes files
through the registered-project configuration, and reuses the existing durable
ingestion path. It does not install hooks, scheduled tasks, services, or remote
collectors. `npm run monitor` intentionally refuses to run without a mode, so a
mistyped collection command cannot silently begin continuous polling. Use
`npm run monitor:continuous -- --interval-ms 10000` to choose another interval
(minimum 1 second).

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
- The dashboard binds to `127.0.0.1`; it is not exposed to your local network.
