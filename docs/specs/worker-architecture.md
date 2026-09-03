# Worker architecture

Companions: [`data-schema.md`](./data-schema.md), [`adr-technology.md`](./adr-technology.md).

One worker process, one Postgres, one ClickHouse, one S3. Jobs share that process and run at their own frequencies (live poll ~3 s, league list hourly, history walk every 2 min, plus on-demand GC / download / parse). The HTTP API stays a thin test harness plus admin purchase (`POST /api/buy-account`, [`marketplace-buy-account.md`](./marketplace-buy-account.md)). Collection must work if the API is down.

```
                    ┌──────────────────┐
                    │ Steam Web API    │  ≤ 1 rps / key  (shared limiter)
                    └────────┬─────────┘
                             ▼
                       ┌──────────┐
                       │  worker  │  live + historical + GC + download + parse
                       └────┬─────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
     Postgres           ClickHouse            S3 .dem.bz2
     (matches, jobs)    (ticks, replay_*)     (download → parse)
```

graphile `priority`: lower number runs first. Live poll / live details / live replay = 0, historical details = 10, history walk / historical replay = 20.

---

## Steam Web API budget

Hard rules:

- **1 request per second per API key**, including retries.
- Never parallelise two Web API calls on the same key.
- Professional matches only. Do **not** walk `GetMatchHistoryBySequenceNum` from seq 0.

Live writes `next_live_poll_at`; historical waits past that instant. GC is **not** in the 100k budget.

---

## Jobs

A job does one unit of work, then re-enqueues itself if more remains.

| identifier | Cadence | One unit |
|---|---|---|
| `poll_live_games` | every `LIVE_POLL_INTERVAL_MS` (3 s) | GetLiveLeagueGames → live ticks + finish detection |
| `fetch_leagues` | hourly + startup | GetLeagueInfoList |
| `walk_league_history` | every 2 min + self-requeue | one GetMatchHistory page **and** one GetMatchHistoryBySequenceNum window |
| `fetch_match_details` | on demand | GC `CMsgGCMatchDetailsRequest` → persist + replay URL. Live: `run_at = finished + 30 min` |
| `download_replay` | after URL is stored | GET that URL → stream `.dem.bz2` to S3 |
| `parse_replay` | after S3 store | decompress, in-process parse, ClickHouse `replay_*` + sparse PG aggregates |

### Live (`poll_live_games`)

GetLiveLeagueGames. Upsert live matches/players/draft. Append `live_match_ticks` / `live_player_ticks`. Finish detection: missing for `LIVE_MISSING_THRESHOLD` polls (empty-list guard). Then enqueue **`fetch_match_details`** at `now + REPLAY_LIVE_DELAY_MS` (30 min). Does **not** enqueue download.

### Historical (`walk_league_history`)

One GetMatchHistory page (newest or older cursor). Persist listed matches. Then **GetMatchHistoryBySequenceNum** from the min seq on that page: persist every row whose `league_id` is already in `leagues`. Enqueue `fetch_match_details` for rows still missing `details_fetched_at`. Does **not** enqueue download.

### Match details (`fetch_match_details`)

GC only. Persist `CMsgDOTAMatch`, copy cluster/salt, set `match_replays.source_url`. Then enqueue `download_replay`. Live-origin jobs are delayed 30 min from finish so Valve has time to publish the file; historical runs immediately.

### Replay download

Requires `source_url` already on `match_replays`. No GC. 404 → backoff. On store, enqueue `parse_replay`.

### Replay parse

S3 → decompress (zstd or bzip2; Valve’s URL still ends in `.dem.bz2`) → Source 2 demo parser in this repo (`packages/shared/src/steam/dem/`) → same NDJSON event types `ingestReplayNdjson` already maps into ClickHouse. Re-parse deletes existing `replay_*` rows for that `match_id`.

The bitstream / send tables / entities follow [dotabuff/manta](https://github.com/dotabuff/manta). Processors emit combat log, 1 Hz intervals, draft timings, chat, wards, starting items, epilogue.

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

- Web API 403/429 → mark key, switch.
- GC timeout → next Steam account; do not block live polls.
- Parse crash → replay stays `stored`, parse retries; S3 is the source of truth.
- Empty GetLiveLeagueGames → do not finish-detect.
- Download without `source_url` → fail until details ran.

---

## Deployment

One `worker` service in compose. graphile-worker concurrency 5. All task identifiers in that process.

API `POST /api/leagues/process-finished` forces `walk_league_history` for an id (reset exhausted).
