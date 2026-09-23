# Monitor reliability targets

## Purpose and scope

This document defines the acceptance targets for the next monitor-reliability
stage. It changes no collector, database, dashboard, or privacy behavior.
The monitor remains local-only, and the browser remains read-only.

## Baseline

At the start of this stage, the registered Agent Tracking System monitor had
45 eligible rollout sources. A read-only checkpoint simulation found about
135 MiB pending after one bounded pass, across 22 partial sources. The
existing per-source 512 KiB limit would require at least 258 30-second cycles
to drain that fixed backlog if no new data arrived.

## Operating targets

1. **Freshness:** after new source writes stop, a registered project with up
   to the baseline backlog must reach `caught_up` within five minutes on this
   computer.
2. **Steady state:** routine monitor cycles must finish before the next
   scheduled cycle and must not overlap or silently starve an eligible source.
3. **Accuracy:** a retry or restart must not double-count a response, advance
   a failed checkpoint, or turn missing role/completion evidence into a guess.
4. **Discovery honesty:** a source whose project metadata cannot be resolved
   within the bounded metadata scan must be represented as incomplete
   discovery in safe aggregate status, rather than silently treated as an
   ordinary ignored source.
5. **Operational visibility:** the local Overview must distinguish the last
   completed monitor cycle from source freshness, show safe aggregate backlog
   state, and never claim that a monitor process is currently running.
6. **Privacy:** no paths, raw errors, rollout content, prompts, transcripts,
   tool data, source identifiers, or checkpoint values may be exposed through
   the dashboard or persisted in a new operational-status record.

## Required acceptance evidence

- A deterministic backlog-drain test using a temporary SQLite database.
- Adversarial tests for oversized early envelopes, growing files, restart and
  replay, a failed transaction, and competing monitor instances.
- A real local controlled catch-up showing current source health, pending
  bytes, and response totals before and after the run.
- A local dashboard/API check showing the new status without exposing excluded
  data.

## Non-goals

This stage does not infer role labels or task completion, alter the local
collection boundary, install a service or scheduled task, or delete historic
rollouts or SQLite data.
