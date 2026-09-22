# Manager Launch Protocol

## 1. Decide whether another agent adds value

Work in the manager for explanation, planning, support, and trivial low-risk
edits. Delegate meaningful implementation to `builder`. Use `scout` only for a
bounded read-only investigation that materially improves speed or evidence.

## 2. Set ownership and validation

Every delegated task states:

```text
Agent: builder / data_trust_reviewer / scout
Goal and non-goals:
Owned files or boundary:
Required validation:
Handoff: result, files changed, validation evidence, privacy/data impact, risks.
```

Never give two agents overlapping write ownership. Keep no more than two child
agents open concurrently, and parallelize only independent boundaries.

## 3. Apply the review gate

After a material implementation, launch `data_trust_reviewer` independently and
read-only. Review is required for changes to stored data, schemas, ingestion,
metrics, privacy, security, cross-component behavior, or release claims. The
manager accepts the result, returns it to the builder for focused rework, or
escalates it.

## 4. Escalate selectively

Use `gpt-6-astra` / `high` only for a consequential privacy or security
decision, major architecture change, significant data-loss risk, or final
high-risk release decision. Escalate to the user for user-level telemetry,
changes to `~/.codex`, remote or cloud collection, broader data collection, or
an unresolved product-purpose decision.
