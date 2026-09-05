# Model and effort routing

## Defaults

All six delivery roles use `gpt-5.6-terra` at `medium` effort. The
read-only `support_explorer` uses `gpt-5.6-luna` at `low` effort. The project
limits routine parallel work to two subagents per coordinating session.

| Task class | Model and effort | Typical work |
| --- | --- | --- |
| Support | Luna low | File inventories, safe summaries, metadata checks, first-pass classification |
| Standard | Terra medium | Normal scoped implementation, review, planning, tests, and dashboard work |
| Complex | Sol medium | Failed validation after two focused attempts, difficult migrations, hidden cross-component bugs, or external integration work |
| High-consequence | Astra high | Cross-system architecture, material privacy/security issue, or final high-risk release decision |

## Escalation rules

Escalation requires evidence, not a role title. Move beyond Terra medium only
when at least one is true:

- Two focused attempts did not resolve the issue.
- Requirements or evidence conflict materially.
- The change crosses systems and a wrong decision would be costly to reverse.
- The work changes privacy, security, telemetry collection, data retention, or
  a production-release boundary.

Do not escalate merely because a task is large, important-sounding, or assigned
to backend, QA, or management. Do not use `xhigh` or `max` as a routine setting.

## Review and measurement

The delivery manager selects an escalation explicitly at task launch and records
the task class, model, effort, validation evidence, and outcome. Review model
effectiveness only within comparable task classes; account for sample size,
rework, and validation status before changing a default.
