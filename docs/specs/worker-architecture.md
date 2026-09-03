# Worker architecture

Companions: [`data-schema.md`](./data-schema.md), [`adr-technology.md`](./adr-technology.md).

One worker process, one Postgres, one ClickHouse, one S3. Jobs share that process and run at their own frequencies (live poll ~3 s, league list hourly, history walk every 2 min, plus on-demand GC / download). The HTTP API stays a thin test harness plus admin purchase (`POST /api/buy-account`, [`marketplace-buy-account.md`](./marketplace-buy-account.md)). Worker also replenishes API keys / GC accounts from `marketplace_products` when `settings` say the ready pool is short. Collection must work if the API is down.

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

graphile `priority`: lower number runs first. Live poll / live details / live replay = 0, historical details = 10, history walk / historical replay = 20.

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
| `poll_live_games` | every `settings.live_poll_interval_ms` (seed 3 s) | GetLiveLeagueGames → live ticks + finish detection |
| `fetch_leagues` | hourly + startup | GetLeagueInfoList |
| `walk_league_history` | every 2 min + self-requeue | one GetMatchHistory page **and** one GetMatchHistoryBySequenceNum window |
| `fetch_match_details` | on demand | GC `CMsgGCMatchDetailsRequest` → persist + replay URL. Live: `run_at = finished + settings.replay_live_delay_ms` |
| `download_replay` | after URL is stored | GET that URL → stream `.dem.bz2` to S3 |
| `replenish_accounts` | every `settings.replenish_interval_ms` + startup | if ready API keys or dedicated GC accounts (plus pending orders) are below `settings`, buy the gap from the whitelist, one store order per missing unit |
| `retest_disabled_resources` | every `settings.retest_interval_ms` + startup | probe disabled proxies / GC accounts / API keys with `retest_count` below the matching `*_retest_max`; restore on success; give up after max |

### Live (`poll_live_games`)

GetLiveLeagueGames. Upsert live matches/players/draft. Append `live_match_ticks` / `live_player_ticks`. Finish detection: missing for `settings.live_missing_threshold` polls (empty-list guard). Then enqueue **`fetch_match_details`** at `now + settings.replay_live_delay_ms`. Does **not** enqueue download.

### Historical (`walk_league_history`)

One GetMatchHistory page (`settings.history_page_size`, newest or older cursor). Persist listed matches. Then **GetMatchHistoryBySequenceNum** (`settings.seq_batch_size`) from the min seq on that page: persist every row whose `league_id` is already in `leagues`. Enqueue `fetch_match_details` for rows still missing `details_fetched_at`, capped by `settings.history_details_enqueue_limit`. Does **not** enqueue download.

### Match details (`fetch_match_details`)

GC only. Persist `CMsgDOTAMatch`, copy cluster/salt, set `match_replays.source_url`. Then enqueue `download_replay`. Live-origin jobs are delayed by `settings.replay_live_delay_ms` from finish so Valve has time to publish the file; historical runs immediately.

### Replay download

Requires `source_url` already on `match_replays`. No GC. 404 → backoff. Stops at `stored` in S3; parse is a later job.

### Replay parse

Not in this worker yet. ClickHouse `replay_*` and `match_replays.parser_version` stay in the schema for the next parser. Replays already in S3 are the source of truth.

---

## League status

Valve `status` is a publication flag. Our `leagues.status`:

1. `LIVE` if the id appears in GetLiveLeagueGames
2. else `UPCOMING` if `now < start_timestamp`
3. else `FINISHED` if `now > end_timestamp` **or** `valve_status = 5` **or** `most_recent_activity` older than 14 days
4. else `LIVE` only inside `[start, end]`

Historical ingest does not wait for `FINISHED`. True live games are only those in GetLiveLeagueGames.

---

## Failure

- Web API 403 → disable that key immediately (no retest). 429 → mark key rate-limited, switch.
- Proxy / GC-account / API-key transport and soft errors go into `resource_attempts`. Disable when the last `*_error_window` attempts are at least `*_error_threshold` percent failures. Do not disable on the first blip.
- A disabled proxy is rotated off the current key/account even before the window fills; it stays in the ready pool until the threshold hits.
- GC timeout → next Steam account; do not block live polls.
- Empty GetLiveLeagueGames → do not finish-detect.
- Download without `source_url` → fail until details ran.

---

## Deployment

One `worker` service in compose. graphile-worker concurrency 5. All task identifiers in that process.

API `POST /api/leagues/process-finished` forces `walk_league_history` for an id (reset exhausted).
