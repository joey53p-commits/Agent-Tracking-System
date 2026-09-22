# Model and effort routing

## Defaults

The manager and builder use `gpt-5.6-terra` at `medium` effort. The data/trust
reviewer uses `gpt-6-sol` at `medium` effort, and the scout uses `gpt-6-luna`
at `low` effort. The project allows at most two concurrent child agents, though
normal implementation and review are sequential.

| Task class | Model and effort | Typical work |
| --- | --- | --- |
| Support | `gpt-6-luna` / `low` | Bounded discovery, inventories, and execution tracing |
| Standard implementation | `gpt-5.6-terra` / `medium` | Planning, implementation, tests, dashboard work, and routine integration |
| Independent review | `gpt-6-sol` / `medium` | Metric review, data contracts, privacy, security, correctness, and evidence quality |
| High-consequence | `gpt-6-astra` / `high` | Consequential privacy/security decisions, major architecture, significant data-loss risk, or final high-risk release decisions |

Do not increase reasoning effort merely because a task is large or important.
Escalation requires material ambiguity, repeated focused failure, conflicting
evidence, or a costly-to-reverse consequence. Do not use `xhigh` or `max` as a
routine setting.

## Runtime verification

Project files express intended routing. They do not prove the runtime honored
it. After routing changes, start a fresh project task and verify the observed
role, model, effort, sandbox, and working directory. Existing tasks retain the
settings with which they were started unless explicitly overridden.
