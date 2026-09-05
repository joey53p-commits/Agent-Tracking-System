# Local task-event database

The collector records approved events in `data/agent-tracking.sqlite` using SQLite. The database is local, ignored by Git, and remains inside this repository's `data/` directory. The collector's privacy gate runs before any database write.

The `task_events` table stores one immutable row for each recorded event. It indexes project/workstream, status, and record time so the future dashboard can query task status, reliability, and cycle-time trends efficiently.

The schema is intentionally small during the pilot. A future migration can add approved task-outcome review without storing raw prompts, transcripts, source code, or credentials.
