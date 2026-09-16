# Plan: Valve request logs + Grafana

Spec: [`docs/specs/request-logs.md`](../specs/request-logs.md).

- [x] Spec: tables, settings flag, retention job, Grafana layout
- [x] Postgres migration: three daily-partitioned tables, `log_valve_requests`, `maintain_request_logs()`
- [x] `db:up` + `db:pull`
- [x] Shared begin/finish logger; Steam / GC / replay insert-before update-after
- [x] `maintain_request_logs` job on match-processing (hourly)
- [x] Seed Web API + replay Prometheus series; `method` on replay download metrics
- [x] Grafana `upstream-apis.json`: RPS / latency / statuses per method for Steam, GC, replay CDN
- [x] Specs: metrics, worker-architecture, data-schema, marketplace settings
- [x] Tests: settings flag, logger, partition maintain, roles, metrics seed
