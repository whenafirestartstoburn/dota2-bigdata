# Dota 2 collector

Internal platform for discovering professional / league Dota 2 matches, storing live and post-match data, and downloading replays. Postgres holds operational state (visible with ordinary SQL). ClickHouse holds high-volume snapshots. Replays stream into Amazon S3 (`S3_*` in `.env`).

Jobs run on [graphile-worker](https://worker.graphile.org) in Postgres — queue, retries, and cron are tables, not a separate broker. Compose runs three worker containers (`WORKER_ROLE=live|historical|match-processing`) against that shared queue. Spec: [`docs/specs/worker-architecture.md`](docs/specs/worker-architecture.md).

## Stack

- Bun + TypeScript (`Bun.serve`, bun.sql + Drizzle, dbmate, biome). Why: [`docs/specs/adr-technology.md`](docs/specs/adr-technology.md).
- graphile-worker
- Postgres 16
- ClickHouse
- Amazon S3
- `steam-user` for Game Coordinator (replay salt / cluster)
- Steam TOTP is vendored (not the old `steam-totp` package)

## Start

```bash
cp .env.example .env
# fill STEAM_SEED_LOGIN / STEAM_SEED_PASSWORD / STEAM_SEED_API_KEY
docker compose up --build
```

- API: http://localhost:3000 (`/healthz`, `/api/health`)
- Live worker: http://localhost:3001/healthz
- Historical worker: http://localhost:3004/healthz
- Match-processing worker: http://localhost:3005/healthz
- Parser health: http://localhost:3002/healthz
- Postgres: `postgres://dota:dota@localhost:5432/dota`
- ClickHouse HTTP: http://localhost:8123

Without docker (infra still from compose):

```bash
docker compose up postgres clickhouse migrate clickhouse-migrate -d
cp .env.example .env
bun install
bun run worker    # all roles in one process; or worker:live / worker:historical / worker:processing
bun run api       # another terminal
```

## Jobs

| Job | Worker | Schedule | What it does |
|---|---|---|---|
| `poll_live_games` | live | every 3s (`jobKey`) | `GetLiveLeagueGames`, current state in Postgres, ticks in ClickHouse |
| `poll_top_live` | live | every 3s | `GetTopLiveGame` (`league_id > 0`) → `server_steam_id`; merges onto the same `matches` row |
| `poll_realtime_stats` | live | every 3s | `GetRealtimeStats` for live rows that have `server_steam_id` |
| `fetch_leagues` | historical | hourly + startup | `GetLeagueInfoList`, upsert `leagues` |
| `walk_league_history` | historical | continuous | `GetMatchHistory` pages (discovery only) |
| `poll_finished_history` | historical | every 5s | `GetMatchHistory` waiter after a live match leaves the feed |
| `process_league` | historical | via HTTP | reset + walk one league |
| `fetch_match_details` | match-processing | on demand | seq window then GC → replay URL |
| `download_replay` | match-processing | after URL | Valve CDN → S3 |
| parser (Go) | parser | polls `match_replays` | `stored` `.dem.bz2` from S3 → ClickHouse `replay_*` |

League status is **ours**, not Valve's `status` integer (that flag is stored as `valve_status`). A league is `LIVE` if it currently appears in live games, or now is between `start_timestamp` and `end_timestamp`; `UPCOMING` if start is in the future; `FINISHED` if the window ended, Valve marked it concluded (`status=5`), or activity is stale.

`GetMatchHistory` / `GetMatchHistoryBySequenceNum` are capped by Valve at **100** matches per call (a request of 1000 is silently truncated). History paginates; seq details walk `match_seq_num` in 100-match global windows.

## Process a finished league

```bash
curl -s http://localhost:3000/api/leagues/process-finished \
  -H 'content-type: application/json' \
  -d '{"league_id":19719,"matches_limit":1}'
```

Then poll:

```bash
curl -s http://localhost:3000/api/leagues/ingest-runs/<id>
```

`matches_limit` caps how many matches get seq details **and** replay jobs (newest `start_time` first). The full history list is still stored.

## Steam accounts

Two pools share `steam_accounts`. Production ignores leftover rows (for example a `shared_secret` with no API key).

- **Web API** uses any account that has a ready row in `steam_api_keys`, whether or not `shared_secret` is set. Keys are provisioned by hand (`steam:guard add` / `issue-api-key`, or `STEAM_SEED_API_KEY`).
- **GC (replay download)** uses imported/bought accounts that have a password, **no** API key, and **no** `shared_secret`. CSV import: `bun run steam:import`.

```bash
# insert another account into steam_accounts (password / API key prompted)
bun run steam:guard add --login otherlogin

# current TOTP from a stored shared_secret
bun run steam:guard code --login otherlogin

# newest Steam Guard code already in the account IMAP mailbox (no Steam login)
bun run steam:guard get-last-code --login otherlogin

# enroll authenticator (email activation via IMAP when mailbox is stored;
# phone/SMS only if Steam requires it). Prints shared_secret, identity_secret,
# revocation_code. Postgres must be up.
bun run steam:guard setup --login otherlogin

# register a Steam Web API key. Needs Guard (from setup) or an IMAP mailbox
# so issue-api-key can enroll Guard first. Default domain is localhost.
# Does not open /dev/apikey — requestkey + mobile confirmation only.
bun run steam:guard issue-api-key --login otherlogin
bun run steam:guard issue-api-key --login otherlogin --domain example.com

# link a phone (email confirmation + SMS). Needed before setup only if Steam
# refuses email enrollment. --country is ISO-3166 (RU, US); inferred from
# the number if omitted.
bun run steam:guard add-phone --login otherlogin --phone +14155550123 --country US

# write a secret you already have into steam_accounts
bun run steam:guard save --login otherlogin --secret 'BASE64_SHARED_SECRET'
```

Keep `revocation_code` if you enroll Guard later. A Web API key on the account is enough for Steam Web API calls; GC never picks a row that has a key or a `shared_secret`.

`STEAM_SEED_*` seeds **one** account on worker/API boot. Extra accounts go in `steam_accounts` / `steam_api_keys`, not extra env vars.

## Accounts, keys, proxies

Rows in `steam_accounts`, `steam_api_keys`, `proxies`. Each worker process seeds one account from `STEAM_SEED_*` on boot. Extra accounts: `bun run steam:guard add`. Replace resources by updating those tables — not env-only configs.

Do not commit `.env`. Passwords and secrets are redacted in pino logs.
