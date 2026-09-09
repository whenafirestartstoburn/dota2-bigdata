# Metrics and observability

Companions: [`worker-architecture.md`](./worker-architecture.md),
[`marketplace-buy-account.md`](./marketplace-buy-account.md),
[`replay-parser.md`](./replay-parser.md).

Worker and parser expose Prometheus text on `GET /metrics`. Compose scrapes
both into Prometheus; Grafana loads provisioned dashboards from
`deploy/grafana/dashboards/`. Collection does not depend on Grafana being up.

## Why

Valve HTTP, Game Coordinator, marketplace buys, and parse are the places
an operator asks “is ingest stuck?”. Logs answer a single match. Counters
and gauges answer the pool: key 403s, GC logon failures, empty ready
accounts, download 404s, parse backlog.

## Process surface

| Process | Path | Port in compose |
|---|---|---|
| worker-live | `GET /metrics` | `worker-live:8080` (host `3001`) |
| worker-historical | `GET /metrics` | `worker-historical:8080` (host `3004`) |
| worker-match-processing | `GET /metrics` | `worker-match-processing:8080` (host `3005`) |
| parser | `GET /metrics` | `parser:8080` (host `3002`) |

`/healthz` and `/readyz` stay liveness / dependency checks. Prometheus is
not a substitute for them.

Local `bun run worker` (all roles) / `worker:live` /
`worker:historical` / `worker:processing` and the parser binary serve
the same paths on `WORKER_PORT` / `PARSER_PORT`.

## Cardinality

Labels are closed enums: API method name, result class, job identifier,
resource kind/status, marketplace store/kind. Never `match_id`,
`league_id`, login, proxy URL, or order UUID.

## Sources

Three Valve planes, plus marketplace and the local pipeline.

| `source` / plane | Where | Methods |
|---|---|---|
| `dota2` | `www.dota2.com/webapi` | `GetLeagueInfoList` |
| `steam` | `api.steampowered.com` | `GetLiveLeagueGames`, `GetTopLiveGame`, `GetRealtimeStats`, `GetMatchHistory`, `GetMatchHistoryBySequenceNum` |
| GC | `steam-user` session | `match_details` (`CMsgGCMatchDetailsRequest`), logon |
| marketplace | Dark Shopping HTTP | `order/create`, `order/status`, `order/download`, `delivery` |
| pipeline | graphile jobs, S3 download, parser | job names, replay status, match phase |

One increment per **logical** Valve call (retries inside `getJson` stay
internal). Marketplace HTTP counts each attempt, including 429 retries.

GC is on-demand and sparse. Dashboards graph the **counters** and
`sum / count` mean latency, not `rate()` / `histogram_quantile` — those
stay empty or NaN after a single scrape that already contains the first
increment. The process seeds zero `match_details` / logon series so the
lines exist before the first session.

## Result classes

Web API / marketplace HTTP: `success`, `http_403`, `http_429`, `http_4xx`,
`http_5xx`, `timeout`, `transport`, `proxy`, `parse`, `public_match`,
`error`.

`public_match` is GetRealtimeStats seeing `league_id <= 0` — not a Valve
outage.

GC request: `success`, `timeout`, `no_account`, `error`.

GC logon: `success`, `timeout`, `invalid_password`, `rate_limit`, `error`.

Jobs: `success`, `error` (`skipped` when the task swallows “no ready Steam
API key”).

Replay download: `success`, `already_stored`, `not_found`, `error`.

Parser: `success`, `s3`, `parse`, `clickhouse`, `publish`.

## Catalog (worker)

Prefix `dota_`. Registry is in-process (`packages/shared/src/metrics`),
not `prom-client`. CLI processes that import jobs inherit the same
counters; only the worker serves them.

| Name | Type | Labels | Meaning |
|---|---|---|---|
| `dota_up` | gauge | | 1 while the process serves `/metrics` |
| `dota_webapi_requests_total` | counter | `source`, `method`, `result` | Dota2.com + Steam Web API logical calls |
| `dota_webapi_request_duration_seconds` | histogram | `source`, `method` | wall time including in-process retries |
| `dota_gc_requests_total` | counter | `method`, `result` | GC RPCs (`match_details`) |
| `dota_gc_request_duration_seconds` | histogram | `method` | |
| `dota_gc_logons_total` | counter | `result` | Steam client logOn / welcome |
| `dota_gc_session_up` | gauge | | 1 while a GC session is bound |
| `dota_jobs_total` | counter | `job`, `result` | graphile task outcomes |
| `dota_job_duration_seconds` | histogram | `job` | |
| `dota_jobs_in_progress` | gauge | `job` | currently running tasks |
| `dota_replay_downloads_total` | counter | `result` | Valve CDN → S3 |
| `dota_replay_download_duration_seconds` | histogram | | |
| `dota_replay_download_bytes_total` | counter | | stored object size |
| `dota_marketplace_http_requests_total` | counter | `store`, `method`, `result` | Dark Shopping HTTP |
| `dota_marketplace_http_request_duration_seconds` | histogram | `store`, `method` | |
| `dota_marketplace_orders_total` | counter | `store`, `kind`, `status` | local order finish (`success` / `failed` / `pending`) |
| `dota_history_walk_matches_total` | counter | | matches listed on GetMatchHistory walk pages |
| `dota_history_walk_pages_total` | counter | `result` | walk ticks: `hits` / `empty` / `skipped` |

Inventory gauges are **reset and rewritten** on each `/metrics` scrape
from Postgres (and `settings`):

| Name | Labels | Meaning |
|---|---|---|
| `dota_resources` | `kind`, `status` | `api_key` / `gc_account` / `proxy` row counts |
| `dota_accounts_ready` | `pool` | same predicate as replenish (`api_key` / `gc`) |
| `dota_accounts_desired` | `pool` | `settings.desired_*` |
| `dota_marketplace_orders` | `store`, `kind`, `status` | rows on `marketplace_orders` |
| `dota_matches` | `phase` | `matches.phase` |
| `dota_live_matches` | | `phase = live` (convenience) |
| `dota_replays` | `status` | `match_replays.status` |
| `dota_graphile_jobs` | `identifier`, `state` | `queued` / `running` / `scheduled` |
| `dota_leagues` | `state` | `walkable` / `visited` / `exhausted` / `never_walked` |

`dota_resources{kind="gc_account",status="active"}` plus
`dota_gc_session_up` is “live GC account count”: how many dedicated GC
rows are in use, and whether this worker holds a session.

## Catalog (parser)

| Name | Type | Labels | Meaning |
|---|---|---|---|
| `dota_up` | gauge | | 1 |
| `dota_parser_jobs_total` | counter | `result` | claim outcomes |
| `dota_parser_job_duration_seconds` | histogram | | S3 + decode + CH + publish |
| `dota_parser_inflight` | gauge | | current parses |
| `dota_parser_queue` | gauge | `status` | `stored` / `parsing` / `failed` on scrape |

## Compose

`prometheus` scrapes the three worker roles and `parser:8080` every 15s
(`job=worker` plus `role=` live / historical / match-processing). Grafana
listens on host `3003` (container 3000; `3000` is already the API).
Datasource uid `prometheus`. Dashboards:

| File | What |
|---|---|
| `collector-overview.json` | live matches, job rates, ready vs desired accounts, parser inflight |
| `upstream-apis.json` | Dota2 / Steam / GC success–fail and latency |
| `accounts-marketplace.json` | inventory, purchases, marketplace HTTP |
| `parser-replays.json` | download + parse + replay/match queues |
| `historical-worker.json` | walk speed (matches/min, pages), league progress, historical jobs |

Anonymous Grafana Viewer is on for local browse; admin is `admin`/`admin`.

## Rejected

| Alternative | Why not |
|---|---|
| `prom-client` / OpenTelemetry SDK | extra catalog dep for a handful of counters; exposition format is small enough to own |
| postgres_exporter | inventory predicates (ready GC = no api key, no shared_secret) live in app SQL already |
| scrape logs into Loki first | this change answers RED + inventory; log search is already pino/slog |
| per-match / per-key labels | cardinality |
