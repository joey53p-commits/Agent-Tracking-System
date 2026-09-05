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
