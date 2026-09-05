# Agent Registry

The registry gives each agent a stable identity within a project. A task records four separate facts:

- **Agent profile** — the individual agent, such as `Rise Front-End Agent`.
- **Role assignment** — the responsibility for that project, such as Front-end implementation.
- **Runtime** — Codex, ChatGPT, or Other for this execution.
- **Model** — the model used for this execution, when known.

The dashboard seeds the seven initial Rise profiles: Manager, Reviewer, Front-End Agent, Back-End Agent, Generalist Coder, QA Agent, and Release Agent. Add profiles in the local Agent Registry panel as the team changes.

GitHub Actions is intentionally not an agent profile. It is an automation and evidence source, so a future CI import should attach workflow results to the task it validates rather than treat the workflow as a performer.

Profiles and assignments are stored only in the local SQLite database. The repository contains the schema and starter definitions, never the user’s task records.
