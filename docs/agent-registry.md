# Agent Registry

The registry gives each agent a stable identity within a project. A task records four separate facts:

- **Agent profile** — the individual agent, such as `Rise Front-End Agent`.
- **Role assignment** — the responsibility for that project, such as Front-end implementation.
- **Runtime** — Codex, ChatGPT, or Other for this execution.
- **Model** — the model used for this execution, when known.

The dashboard seeds the six initial Agent Tracking System profiles: Foundation & Architecture; Telemetry, Privacy & Data Collection; Metrics, Roles & Evaluation; Backend, Database & Integrations; Dashboard UX & Frontend; and QA, Security & Pilot Review. These are the delivery-team roles defined in [the team charter](agent-team.md). Add profiles in the local Agent Registry panel as the team changes.

GitHub Actions is intentionally not an agent profile. It is an automation and evidence source, so a future CI import should attach workflow results to the task it validates rather than treat the workflow as a performer.

Profiles and assignments are stored only in the local SQLite database. The repository contains the schema and starter definitions, never the user’s task records.

## Stage 2.5 tracker-side role contract

The tracker owns a small static role registry in `packages/agent-registry`. It is a
classification contract only: it does not change the observer, ingest hook events,
write SQLite records, or render a dashboard.

| Stable key | Display label | Registered source aliases |
| --- | --- | --- |
| `manager` | Manager | `manager`, `foundation_architecture` |
| `generalist` | Generalist | `generalist`, `agent`, `default` |
| `frontend` | Frontend | `frontend`, `frontend_builder`, `dashboard_frontend` |
| `backend` | Backend | `backend`, `backend_builder`, `backend_integrations` |
| `reviewer` | Reviewer | `reviewer`, `qa_security` |

Classification accepts only a safe source-agent name and/or a source-agent path.
It normalizes case, spaces, and hyphens, then requires an exact alias match to
the name or one complete path segment. It never uses task titles, prompts,
transcripts, source code, tool inputs/outputs, or substring inference. A child
without an exact registered alias remains `unknown` with the label `Unknown role`.

System guardians are operational controls, not project agents. A record is
classified as `system_guardian` and excluded from project-agent totals only when
its path is rooted at `system` and identifies a registered guardian, or when its
explicit origin is `system` and its name is a registered guardian. This strict
rule prevents an ordinary project child whose name merely contains “guardian”
from being silently excluded. All other sources remain project agents, including
unknown children; unknown is an honest role label, not a claim that no agent ran.
