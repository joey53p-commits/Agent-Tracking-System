# Agent Tracking System team

## Purpose

This is the durable operating model for building and reviewing Agent Tracking
System. A chat gives an agent a workstream; this document defines how those
workstreams cooperate when code is changed.

## Roles

| Role | Owns | Does not own |
| --- | --- | --- |
| Foundation & Architecture | Product boundary, architecture, sequencing, integration, final decisions | Specialist implementation without review |
| Telemetry, Privacy & Data Collection | Safe collection, local collector, source adapters, redaction, retention | Global telemetry enablement without user approval |
| Metrics, Roles & Evaluation | Event meaning, role registry, outcomes, workload and model-comparison rules | Claiming a productivity ranking from inadequate data |
| Backend, Database & Integrations | Event schema, database, APIs, ingestion, repository/CI links | Storing sensitive source material by convenience |
| Dashboard UX & Frontend | Local dashboard layout, filters, drill-downs, user workflow | Redefining metrics without the measurement owner |
| QA, Security & Pilot Review | Test strategy, data-quality checks, threat/privacy review, release gates | Shipping a privacy-sensitive change without evidence |

## Work types and review matrix

| Change type | Primary owner | Review gate |
| --- | --- | --- |
| Event schema or database migration | Backend | Metrics and QA review |
| Redaction, retention, or source adapter | Telemetry | QA review; Foundation approval for scope |
| New dashboard measure or interpretation | Metrics | Dashboard UX review |
| New dashboard flow or major visual change | Dashboard UX | Metrics review |
| CI, Git, or external-system integration | Backend | Telemetry and QA review |
| Release, security, or privacy claim | QA | Foundation acceptance |

## Handoff standard

Every handoff must identify:

1. The decision or behavior delivered.
2. Files changed and intentionally untouched boundaries.
3. Validation run and result.
4. Privacy/data implications.
5. Open risks, deferred work, or a requested decision.

## Effectiveness principles

- Measure task outcomes, evidence, and rework—not activity volume alone.
- Compare models only within comparable task types and complexity ranges.
- Show coverage and sample size beside effectiveness measures.
- Treat time, token counts, tool calls, and changed lines as diagnostics rather
  than primary performance scores.
- Record changed requirements separately from implementation rework.

## Team evolution

Add a role only when it has a sustained, distinct responsibility or security
boundary. Retire or merge a role when it only duplicates another role. The
database may contain many tracked agent profiles; this delivery team should
remain small enough that ownership stays clear.

## Launch and acceptance

Foundation & Architecture uses the [Manager Launch Protocol](manager-launch-protocol.md)
to choose the owner, task class, review gate, and sequencing before delegating
material work. The protocol is the source of truth for when an agent should
work alone, when independent review is required, and when a model escalation is
justified.
