# Plan: Prometheus metrics + Grafana

Spec: [`docs/specs/metrics.md`](../specs/metrics.md).

- [x] Spec: catalog, labels, compose, dashboards
- [x] Shared Prometheus text registry + observe helpers + inventory scrape
- [x] Instrument Steam/Dota Web API, GC, jobs, download, marketplace
- [x] Worker `GET /metrics`
- [x] Parser `/metrics` + job/queue gauges
- [x] Compose Prometheus + Grafana + provisioned dashboards
- [x] Tests for registry + result classification
