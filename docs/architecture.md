# Architecture

```text
Codex rollout files     Reviewed task records
        |                       |
 local rollout monitor     manual collector
        |                       |
        +--- privacy/adapters --+
                    |
          normalized safe records
                    |
         local SQLite transactions
                    |
          read-only local API
                    |
      dashboard periodic GET refresh
```

The tracker reads product repositories as sources and never edits them.
The rollout monitor and dashboard stay on this computer: the monitor reads
local files and SQLite, while the dashboard server binds to `127.0.0.1`. The
browser never discovers files, runs ingestion, or writes rollout records.
