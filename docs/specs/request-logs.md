# Valve request logs

Companions: [`metrics.md`](./metrics.md) (Prometheus / Grafana),
[`worker-architecture.md`](./worker-architecture.md),
[`data-schema.md`](./data-schema.md).

Prometheus answers “is the pool sick?” with closed-enum rates. These
tables answer “what did Valve actually return for this call?” — match
id, HTTP / GC status, body size, truncated error text. They are
operational, not match facts.

## Why

The upstream Grafana board mixed method and result on one Steam panel,
graphed GC as a lifetime counter (not RPS), and omitted Valve CDN
downloads. Retries inside `getJson` never became rows. An operator
debugging a stuck match had logs and a status column, not the request.

## Tables

Daily-partitioned Postgres, UTC midnight bounds. Shared attempt
columns on all three. `steam_api_requests` and `steam_gc_requests`
also store which Steam API key / account made the call
(`steam_api_key_id`, `steam_account_id`). `match_id` is nullable
(no FK): list endpoints have none; GetRealtimeStats / GC / replay
fill it. A missing `matches` / `steam_api_keys` / `steam_accounts`
row must not fail the insert.

| Table | Plane | `method_name` examples |
|---|---|---|
| `steam_api_requests` | `api.steampowered.com` **and** `www.dota2.com` GetLeagueInfoList | `GetLiveLeagueGames`, `GetTopLiveGame`, `GetRealtimeStats`, `GetMatchHistory`, `GetMatchHistoryBySequenceNum`, `GetLeagueInfoList` |
| `steam_gc_requests` | Dota GC RPC | `CMsgGCMatchDetailsRequest` |
| `replay_requests` | Valve CDN `.dem.bz2` GET | `GetReplay` |

| Column | Notes |
|---|---|
| `id`, `created_at`, `updated_at` | surrogate PK is `(id, created_at)` because of RANGE partitioning; `set_updated_at` on the parent |
| `match_id` | null on league / live-list / history pages |
| `method_name` | Steam Web API method, GC message, or `GetReplay` |
| `response_time` | wall ms of **that attempt** (network + body read), null until finished |
| `response_status` | HTTP status (`200`, `429`), GC `EResult` (`1`, `15`), or `timeout` / `error` when there was no status |
| `response_size_kb` | response bytes / 1024; replay success uses the stored object size |
| `error_response` | non-success only, `char_length <= 1000` (app truncates) |
| `response_body` | jsonb, `steam_api_requests` only: parsed JSON of a 200 response. Null on errors, GC / replay rows, and `fetch_seq_window` (`GetMatchHistoryBySequenceNum` walker pages) |
| `steam_api_key_id` | `steam_api_keys.id` that supplied the Web API key. Set on `steam_api_requests`. Null on GC (no key) and on rows written before this column |
| `steam_account_id` | `steam_accounts.id` that owns the API key, or the GC session account. Set on `steam_api_requests` and `steam_gc_requests`. Not on `replay_requests` |

One row per **attempt**, not per logical `steamCall`. Insert immediately
before `steamFetch` / `sendToGC` / CDN `fetch`. Update after the
response (or transport error). A crash leaves `response_*` null — that
is an in-flight / hung call.

`already_stored` replay short-circuit and unpublished cluster 0/1 hosts
do not insert: no Valve request was sent. Account logon is
`dota_gc_logons_total`, not `steam_gc_requests`.

## Settings

| key | seed | meaning |
|---|---|---|
| `log_valve_requests` | `true` | workers insert/update the three tables when `true` |

Read through `getAppSettings().logValveRequests`. A failed insert must
not fail ingest (warn and continue).

## Retention

`maintain_request_logs` (match-processing, startup + hourly,
priority 40) calls `public.maintain_request_logs()`. It creates UTC
partitions for `[today-3d, today+2d)` and `DROP`s partitions whose
day is older than 3 days. The worker does not issue `CREATE TABLE` /
`DROP TABLE` itself. Typed Steam DTOs and schema-drift alerts:
[`steam-api.md`](./steam-api.md).

## Grafana

`deploy/grafana/dashboards/upstream-apis.json` (uid `dota-upstream`) is
the Valve RED board. Three planes, three graphs each: RPS **per
method**, response time **per method**, statuses **per method**.
GetLeagueInfoList is a Steam-board method (`source="dota2"`), not a
separate product. Replay uses `dota_replay_downloads_total{method="GetReplay"}`.

Prometheus stays closed-enum (`method`, `result`). Per-match text lives
only in Postgres.
