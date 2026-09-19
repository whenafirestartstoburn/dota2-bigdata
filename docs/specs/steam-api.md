# Steam Web API client

Companions: [`request-logs.md`](./request-logs.md), [`metrics.md`](./metrics.md).

All `api.steampowered.com` / `www.dota2.com` calls go through
`packages/shared/src/steam/api/`. One request pipeline, one Zod DTO per
method, one drift check per successful JSON body.

## Methods

| Method | Host | Envelope |
|---|---|---|
| `GetLeagueInfoList` | `www.dota2.com` | `{ infos: LeagueInfo[] }` |
| `GetLiveLeagueGames` | Steam | `{ result: { games: LiveLeagueGame[] } }` |
| `GetMatchHistory` | Steam | `{ result: { status, matches, … } }` |
| `GetMatchHistoryBySequenceNum` | Steam | `{ result: { status, matches } }` |
| `GetTopLiveGame` | Steam | `{ game_list: TopLiveGameEntry[] }` |
| `GetRealtimeStats` | Steam | `{ match, teams, buildings?, graph_data? }` |

Sampled 2026-09-19: `GetLeagueInfoList` items carry exactly
`league_id`, `name`, `tier`, `region`, `most_recent_activity`,
`total_prize_pool`, `start_timestamp`, `end_timestamp`, `status`. Other
DTOs follow Valve’s published fields plus the keys this repo already
reads (`leagueid`, `accountid`/`heroid`, scoreboard `death` vs
`deaths`, …).

An empty `games` / `matches` / `infos` / `game_list` / `teams` array is
a valid response, not a parse error and not schema drift.

## Request log body

`steam_api_requests.response_body` (jsonb) stores the parsed JSON of a
**200** attempt. Errors stay in `error_response`. Retention for all
three Valve log tables is **3** UTC days (`maintain_request_logs`
default).

## Schema drift

After JSON parse, walk the raw body against the method’s field spec.

| Finding | Meaning | Not a finding |
|---|---|---|
| unexpected | key present that the DTO does not declare | — |
| missing | required DTO key absent on a present object | optional/default keys omitted; **empty arrays** (no child objects to check) |

Notify at most once per method per hour
(`steam_api_schema_alerts.last_notified_at`). The HTTP call is
fire-and-forget: 2 s timeout, errors logged, ingest continues.

`POST {TELEGRAM_NOTIFICATIONS_URL}/send` with `chatType` (or
`chatId`) and HTML `text`. Empty URL skips the HTTP call.
