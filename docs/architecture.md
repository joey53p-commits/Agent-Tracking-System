# Architecture

```text
Codex task records     Git history / CI
        |                    |
        +---- collectors ----+
                 |
           redaction gate
                 |
        normalized task events
                 |
        local event database
                 |
     dashboard and periodic reports
```

The tracker reads product repositories as sources and never edits them.
