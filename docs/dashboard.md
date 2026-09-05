# Local dashboard

Run the dashboard from the repository root:

```powershell
npm run dashboard
```

Open `http://127.0.0.1:4173` in a browser on the same computer. The server binds only to `127.0.0.1` and exposes a small local API for the dashboard interface; it does not serve the SQLite database file or bind to the network.

The first view shows total, completed, interrupted, and retried task counts; workstream progress; and the latest task evidence. Project, workstream, and status filters update the task list without changing stored data. The pilot catalog makes every filter usable before events exist, and recorded projects or workstreams are added automatically.
