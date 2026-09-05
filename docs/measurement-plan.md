# Pilot measurement plan

## What counts as one task

A task is one user-directed objective with a clear starting request and a final outcome. It may include multiple agent turns, retries, approvals, and validation commands. A new objective starts a new task.

## What the pilot measures

- Throughput: completed tasks by project and workstream.
- Cycle time: elapsed time from task start to completion or blocking.
- Reliability: failed or reworked tasks and retry count.
- Evidence: recorded validation steps before an accepted result.
- Waiting: time spent waiting for approval or an external dependency.

## What it does not measure yet

Do not use the pilot to rank agents, infer individual productivity, or measure quality from time alone. Those require enough reviewed task outcomes and a consistent definition of acceptance.

## Collection workflow

1. Prepare a short, safe JSON event using `examples/rise-task-event.json`.
2. Run the collector in dry-run mode and inspect the normalized result.
3. Run it without `--dry-run` only after the event passes review.
4. The collector saves approved events in `data/agent-tracking.sqlite`, which Git ignores.

```powershell
node apps/collector/collect.js --input examples/rise-task-event.json --dry-run
node apps/collector/collect.js --input examples/rise-task-event.json
```
