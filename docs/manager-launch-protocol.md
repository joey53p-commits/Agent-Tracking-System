# Manager Launch Protocol

## Purpose

Foundation & Architecture acts as Delivery Manager and Integrator. Before
starting material work, it uses this protocol to select a single owner, decide
whether delegation adds value, and set the required review and validation.

This is a routing checklist, not an always-on manager or a requirement to use
multiple agents. Work alone when a single owner can complete it safely.

## 1. Classify the task

| Class | Meaning | Default model and effort |
| --- | --- | --- |
| Support | Bounded evidence gathering or repetitive low-risk work | Luna low |
| Standard | Scoped implementation or review with clear validation | Terra medium |
| Complex | Failed focused attempts, difficult integration, migration, or hidden cross-component bug | Sol medium |
| High-consequence | Cross-system architecture, material privacy/security issue, or final high-risk release decision | Astra high |

Use the escalation evidence in [model routing](model-routing.md). A task's role
title, file count, or perceived importance alone does not justify escalation.

## 2. Decide whether to delegate

Keep one owner when the change is scoped, low-risk, and has clear validation.
Delegate only if a specialist can work independently or independently review a
material risk. Do not delegate simply to keep agents busy.

Never create more than two routine subagents in parallel. Never give two writing
agents overlapping file ownership. When a shared schema, API, or contract
changes, settle the contract first and then hand it to the dependent owner.

## 3. Select the owner and reviewer

| Work | Primary owner | Independent review when material |
| --- | --- | --- |
| Scope, sequencing, cross-cutting integration | Foundation & Architecture | QA, Security & Pilot Review |
| Safe collection, redaction, retention, source adapters | Telemetry, Privacy & Data Collection | QA, Security & Pilot Review |
| Event meaning, roles, outcomes, quality, model evaluation | Metrics, Roles & Evaluation | Dashboard UX & Frontend or QA, depending on risk |
| Event schema, storage, APIs, Git/CI evidence links | Backend, Database & Integrations | Metrics, Roles & Evaluation and QA |
| Dashboard layout, filters, drill-downs, task workflow | Dashboard UX & Frontend | Metrics, Roles & Evaluation when metric meaning changes |
| File inventories, test summaries, source mapping | Support Explorer | None unless findings affect a material decision |

The owner may not independently accept a material change they implemented. The
reviewer remains read-only and returns evidence-based findings; the Delivery
Manager accepts, returns for rework, or escalates the decision.

## 4. Launch brief

Every delegated task must include:

```text
Task class: support / standard / complex / high-consequence
Primary owner: <named role>
Delegated reviewer or support role: <none or named role>
Goal and non-goals:
Owned files or boundaries:
Required validation:
Handoff: result, files changed, validation evidence, privacy impact, and risks.
```

The Delivery Manager must say whether agents should wait for each other or can
work in parallel. Parallel work is allowed only for independent boundaries.

## 5. Acceptance and escalation

For routine work, the owner validates and reports the result. For material work,
the Delivery Manager checks the handoff and required independent review before
accepting it.

Escalate to the user, rather than another model, for enabling user-level
telemetry, changing `~/.codex`, remote collection, cloud storage, broader data
collection, unresolved privacy/security scope, or a material product-purpose
decision.

## Examples

| Request | Routing decision |
| --- | --- |
| Adjust dashboard card spacing | Dashboard UX alone, standard / Terra medium |
| Map collector files before a change | Support Explorer, support / Luna low, read-only |
| Add a redaction rule | Telemetry owns; QA independently reviews; Terra medium unless escalation evidence appears |
| Change event schema and display a new field | Backend settles schema first; Dashboard follows; Metrics and QA review; sequence work |
| Investigate suspected privacy leak | Telemetry plus QA; Astra high only if evidence or decision is materially ambiguous |
