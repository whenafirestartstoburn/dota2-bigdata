# Plan: typed Steam API + request body + drift

Spec: [`docs/specs/steam-api.md`](../specs/steam-api.md).

- [x] Spec
- [x] Migration: `response_body jsonb`, retain_days default 3, `steam_api_schema_alerts`
- [ ] `db:up` + `db:pull` (run locally — applies this file and updates schema dump)
- [x] Unified `steam/api` client, typed DTOs, parse helpers
- [x] Drift + 1 h cooldown + non-blocking telegram (2 s)
- [x] telegram-notifications image → GHCR (`:0.1.0`), compose service
- [x] Specs: request-logs, data-schema, worker-architecture, job-graph
- [x] Tests: parse, drift, notify, request-logs body + 3-day retain
