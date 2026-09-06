# Worker architecture

Companions: [`data-schema.md`](./data-schema.md), [`adr-technology.md`](./adr-technology.md).

One worker process, one Postgres, one ClickHouse, one S3. Jobs share that process and run at their own frequencies (live poll ~3 s, league list hourly, history walk continuously at `steam_api_min_interval_ms`, plus on-demand GC / download). The HTTP API stays a thin test harness plus admin purchase (`POST /api/buy-account`, [`marketplace-buy-account.md`](./marketplace-buy-account.md)). Worker also replenishes API keys / GC accounts from `marketplace_products` when `settings` say the ready pool is short. Collection must work if the API is down.

```
                    ┌──────────────────┐
                    │ Steam Web API    │  ≤ 1 rps / key  (shared limiter)
                    └────────┬─────────┘
                             ▼
                       ┌──────────┐
                       │  worker  │  live + historical + GC + download
                       └────┬─────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
     Postgres           ClickHouse            S3 .dem.bz2
     (matches, jobs)    (ticks, replay_*)     (download)
```

graphile `priority`: lower number runs first. Live poll / live details / live replay = 0, historical details = 10, history walk / historical replay = 20. `fetch_match_details` uses five named queues (`details:0`…`details:4`, `match_id % 5`) so at most five details jobs run at once. `download_replay` uses ten live and ten historical queues (`replay-live:0`…`replay-live:9`, `replay-historical:0`…`replay-historical:9`, `match_id % 10`). On a free shard, live (priority 0) is picked before historical (priority 10 / 20).

Match truth lives on `matches` (phase, `waiting_for`, counters, last error / key / account / proxy). graphile-worker tables are the queue, not the pipeline status.

---

## Steam Web API budget

Hard rules:

- **1 request per second per API key**, including retries (`settings.steam_api_min_interval_ms`).
- Never parallelise two Web API calls on the same key.
- Professional matches only. Do **not** walk `GetMatchHistoryBySequenceNum` from seq 0.

Live writes `next_live_poll_at`; historical waits past that instant. GC is **not** in the 100k budget.

---

## Jobs

A job does one unit of work, then re-enqueues itself if more remains.

| identifier | Cadence | One unit |
|---|---|---|
| `poll_live_games` | every `settings.live_poll_interval_ms` (seed 3 s) | GetLiveLeagueGames → live ticks + DB finish detection |
| `poll_top_live` | same interval | GetTopLiveGame (`league_id > 0`) → `server_steam_id` + finish detection |
| `poll_realtime_stats` | same interval | GetRealtimeStats for live rows with `server_steam_id`, paced by the key limiter |
| `poll_finished_history` | every `settings.history_fast_poll_ms` (seed 5 s) | one newest GetMatchHistory page per due league with `awaiting_history` matches |
| `fetch_leagues` | hourly + startup | GetLeagueInfoList |
| `walk_league_history` | continuous self-requeue (`steam_api_min_interval_ms`) | one GetMatchHistory page (discovery only) |
| `fetch_match_details` | on demand | GetMatchHistoryBySequenceNum (if needed) **then** GC `CMsgGCMatchDetailsRequest` → persist + replay URL |
| `download_replay` | after URL is stored | GET that URL → stream `.dem.bz2` to S3 |
| `replenish_accounts` | every `settings.replenish_interval_ms` + startup | if ready API keys or dedicated GC accounts (plus pending orders) are below `settings`, buy the gap from the whitelist, one store order per missing unit |
| `retest_disabled_resources` | every `settings.retest_interval_ms` + startup | probe disabled proxies / GC accounts / API keys with `retest_count` below the matching `*_retest_max`; restore on success; give up after max |
| `sync_catalogs` | worker boot (sync, before ingest jobs) + daily 05:00 UTC | refresh `heroes` / `items` / `patches` / `abilities` / facets / modes / regions from dotaconstants |

### Live (`poll_live_games`)

GetLiveLeagueGames. Upsert live matches/players/draft. Append `live_match_ticks` / `live_player_ticks` (`source = GetLiveLeagueGames`). Add `GetLiveLeagueGames` to `ingest_sources`. Store `live_duration_max` from the scoreboard clock. Finish detection is **in Postgres**: increment `live_league_missed_polls` for `phase = live` rows that have this ingest source and are absent from the response; reset to 0 when seen. Empty-list guard: do not increment. A match leaves `live` only when **every feed that listed it** has crossed `settings.live_missing_threshold`. If `live_duration_max > 0` (horn happened): `phase = awaiting_history`, `waiting_for = history`. If the clock never left 0 (empty lobby / ghost listing): `phase = not_started`, `last_error_kind = not_started` — do **not** poll GetMatchHistory. A later live sighting flaps `not_started` back to `live`. Walk/history listing still promotes `not_started` to `awaiting_details` if Valve later publishes the id. Does **not** enqueue details or download.

### Top live (`poll_top_live`)

GetTopLiveGame (`partner=0`). Keep `league_id > 0`. Upsert `server_steam_id` (Steam uint64 as decimal text — `Number` rounds it), `ingest_sources += GetTopLiveGame`, `phase = live` unless already past details. Same miss-counter pattern on `top_live_missed_polls`. Same finish rule as the live poller (both feeds must be done if both listed the match).

### Realtime stats (`poll_realtime_stats`)

Whole match, same cadence as live poll — not a 1 s draft-only scanner. Select `phase = live` rows with `server_steam_id`, oldest `last_realtime_at` first. Call GetRealtimeStats through the shared 1 rps limiter until `live_poll_interval_ms` elapses; leftovers wait for the next tick. Upsert PG teams / players / draft / score. Append CH ticks with `source = GetRealtimeStats`. If the server hosts a pub (`league_id <= 0`), clear `server_steam_id` and stop scanning that id.

### Finished-history waiter (`poll_finished_history`)

Coalesce by **league**: one newest GetMatchHistory page per due `league_id` (`phase = awaiting_history` and `history_next_poll_at <= now()`). Counters apply to every waiting match in that league.

- Hit: persist listing fields, `ingest_sources += GetMatchHistory`, `phase = awaiting_details`, enqueue `fetch_match_details` (live priority). Replay delay is **not** applied here.
- Miss: bump `history_poll_fast_count` (limit `settings.history_fast_poll_limit`, interval `history_fast_poll_ms`) then `history_poll_slow_count` (limit `history_slow_poll_limit`, interval `history_slow_poll_ms`). After both limits: `phase = failed`, `last_error_kind = history_timeout`.

### Historical discovery (`walk_league_history`)

One GetMatchHistory page (`settings.history_page_size`, newest or older cursor). Persist listed matches (`source` stays `live` if already live; otherwise `historical`). `ingest_sources += GetMatchHistory`. Set `phase = awaiting_details` when the row is still `discovered`, `awaiting_history`, or `not_started`. Enqueue `fetch_match_details` for any rows still missing `seq_fetched_at` or `details_fetched_at` (live first), capped by `settings.history_details_enqueue_limit` (runnable jobs only — exhausted retries do not fill the cap). An empty page marks the league `history_exhausted` and the next tick picks another league (never self-requeue the same empty id). After every tick, self-requeue on `jobKey = walk_league_history` at `settings.steam_api_min_interval_ms`; the shared 1 rps limiter still yields to live. Older pages of the current league stay on the payload; otherwise `pickNextHistoryLeague` (never-walked first). A 5-minute cron with `preserve_run_at` is only a watchdog. Does **not** call GetMatchHistoryBySequenceNum and does **not** enqueue download.

### Match details (`fetch_match_details`)

Shared by live-finished and historical matches. At most five run at once
(`details:{match_id % 5}`). Live origin is priority 0 and is picked before
historical (priority 10) on a free shard.

1. If `seq_fetched_at` is null and `match_seq_num` is set: GetMatchHistoryBySequenceNum from that seq (`settings.seq_batch_size`). Persist every known-league row in the window. Set `seq_fetched_at` on those ids so overlapping jobs skip the same window.
2. GC `CMsgGCMatchDetailsRequest`. Persist `CMsgDOTAMatch`, copy cluster/salt, set `match_replays.source_url` and `details_fetched_at`.
3. Enqueue `download_replay`. Live origin: `run_at = replay_available_at` (`finished_at + settings.replay_live_delay_ms`, seed 30 s) if that instant is still in the future. Historical runs immediately.

`waiting_for` flips `seq` → `gc` → `replay`.

### Replay download

Requires `source_url` already on `match_replays`. No GC. 404 → `replayBackoffMs` (1 m, 1 m, 3 m × 20, 1 h × 24) then `match_replays.status = unavailable`, `matches.phase = replay_unavailable`, `last_error_kind = unavailable`. Stops at `stored` in S3; parse is a later job. Sets `matches.phase = replay_stored`. Run cap is ten live + ten historical (`REPLAY_PARALLELISM`); historical enqueue is still `settings.history_replay_enqueue_limit`.

### Replay parse

Separate Go process (`packages/parser`). Polls `match_replays` with `status = stored`, downloads the S3 object, decodes the demo with our Source 2 parser, commits ClickHouse `replay_*` under a `parse_run_id`, then sets `match_replays.status = parsed` **and** `matches.phase = parsed`. Parallelism is `settings.parser_parallelism` (seed 10). Spec: [`replay-parser.md`](./replay-parser.md).

---

## League status

Valve `status` is a publication flag. Our `leagues.status`:

1. `LIVE` if the id appears in GetLiveLeagueGames **or** GetTopLiveGame
2. else `UPCOMING` if `now < start_timestamp`
3. else `FINISHED` if `now > end_timestamp` **or** `valve_status = 5` **or** `most_recent_activity` older than 14 days
4. else `LIVE` only inside `[start, end]`

Historical ingest does not wait for `FINISHED`. A match is live only while a live feed still lists it.

---

## Failure

- Web API 403 → disable that key immediately (no retest). 429 retries in the request; the key is parked `rate_limited` only if every attempt 429s. A later HTTP 200 (or a successful pick) clears `rate_limited_until`. The key is pickable again when `rate_limited_until` is null or past.
- Proxy / GC-account / API-key transport and soft errors go into `resource_attempts`. Disable when the last `*_error_window` attempts are at least `*_error_threshold` percent failures. Do not disable on the first blip.
- A disabled proxy is rotated off the current key/account even before the window fills; it stays in the ready pool until the threshold hits.
- GC timeout → next Steam account; do not block live polls.
- Empty GetLiveLeagueGames / GetTopLiveGame → do not finish-detect that feed.
- Download without `source_url` → fail until details ran.
- 200 history misses → `phase = failed`, `last_error_kind = history_timeout`.

---

## Metrics

Worker and parser expose Prometheus on `GET /metrics`. Compose scrapes them
into Prometheus; Grafana on host `:3003` loads provisioned dashboards.
Catalog: [`metrics.md`](./metrics.md).

## Deployment

One `worker` service in compose. graphile-worker concurrency 35 (so live polls are not blocked while five details queues and twenty replay-download shards are busy). All task identifiers in that process.

API `POST /api/leagues/process-finished` forces `walk_league_history` for an id (reset exhausted).

### Catalogs (`sync_catalogs`)

`heroes` / `items` / `patches` (and abilities, facets, modes, …) are lookup tables. Match ingest writes Valve ids and never fills those rows — that is why an empty `heroes` table with a full `match_draft` is possible. The worker **blocks ingest startup** on a successful catalog sync when `heroes` is empty, and otherwise keeps the last good rows if the feed is down. CLI: `bun run catalogs:sync`.
