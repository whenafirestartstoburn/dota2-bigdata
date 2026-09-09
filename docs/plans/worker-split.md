# Plan: split worker into three containers

Spec: [`docs/specs/worker-architecture.md`](../specs/worker-architecture.md).

Instance (`olegr@dota2-bigdata`): 4 vCPU, 16 GiB, no swap. Compose
limits for the whole stack sum to ≤ 90% of that (3.6 CPU, ~14.4 GiB).

- [x] Spec: three roles, job ownership, live-feed merge, resource budget
- [x] `WORKER_ROLE` + task lists + boot/cron per role
- [x] Same worker image, three compose services + Prometheus targets
- [x] Live+top `touchMatchLive` merge (nulls, not zeros)
- [x] Tests: roles, live merge, top-live filter, realtime parsers, origins
- [x] README / CLAUDE / metrics / ADR
