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
| `GetRealtimeStats` | Steam | `{ match, teams, buildings?, graph_data?, delta_frame? }` |

Sampled 2026-09-19 from live 200 bodies. DTOs include Valve’s current
keys, not only the subset this repo persists. Live extras that are
declared (so they are not drift): `GetLiveLeagueGames` `result.status`
and side `abilities`; `GetTopLiveGame` query-echo envelope
(`search_key`, `league_id`, `hero_id`, `start_game`, `num_games`,
`game_list_index`, `specific_games`, `bot_game` — flag or a game
object) plus
`is_player_draft` / `is_watch_eligible` on each game;
`GetMatchHistory` player `hero_variant`. Anonymous history players
omit `account_id` — that is not missing. `GetMatchHistoryBySequenceNum`
match `tournament_id` / `tournament_round` (not on every match).
`GetRealtimeStats` `match.lobby_type` / `start_timestamp` /
`is_player_draft`, team `team_tag` / `team_logo_url`, and envelope
`delta_frame`. Also `leagueid`, `accountid`/`heroid`, scoreboard
`death` vs `deaths`.

An empty `games` / `matches` / `infos` / `game_list` / `teams` array is
a valid response, not a parse error and not schema drift.

## Request log body

`steam_api_requests.response_body` (jsonb) stores the parsed JSON of a
**200** attempt. Errors stay in `error_response`. `fetch_seq_window`
passes `logResponseBody: false` so walker `GetMatchHistoryBySequenceNum`
pages stay null (the bodies are large). Retention for all three Valve
log tables is **3** UTC days (`maintain_request_logs` default).

## Schema drift

After JSON parse, walk the raw body against the method’s field spec.

| Finding | Meaning | Not a finding |
|---|---|---|
| unexpected | key present that the DTO does not declare | — |
| missing | required DTO key absent on a present object | optional/default keys omitted; **empty arrays** (no child objects to check) |

Notify at most once per method per hour
(`steam_api_schema_alerts.last_notified_at`). The same table also
holds marketplace fail cooldown keys (`marketplace:{store}:{kind}:{signature}`,
10 minutes; see [`marketplace-buy-account.md`](./marketplace-buy-account.md)).
The HTTP call is fire-and-forget: 2 s timeout, errors logged, ingest
continues.

`POST {TELEGRAM_NOTIFICATIONS_URL}/send` with HTML `text` and a
destination from env: `TELEGRAM_NOTIFICATIONS_CHAT_ID` (any Telegram
chat id / `@username`) or `TELEGRAM_NOTIFICATIONS_CHAT_TYPE` (a name
registered in telegram-notifications, e.g. `dev_dataluna`). `chatId`
wins when both are set. Empty URL or empty destination skips the HTTP
call.
