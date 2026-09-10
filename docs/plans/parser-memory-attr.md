# Plan: parser RAM, wall time, entity stamps

Spec: [`docs/specs/replay-parser.md`](../specs/replay-parser.md),
[`docs/specs/data-schema.md`](../specs/data-schema.md).

Player identity on ClickHouse is Steam `account_id` (same as
`players.account_id` / `match_players.account_id`). Not Postgres
`players.id`, not Valve `player_id` (0–23 resource index). Missing = `0`.

- [x] Spec: `account_id` on every `replay_*` row; combat attacker/target;
      discard unused entity classes; mid-decode flush is the RAM contract
- [x] CH: `account_id` on replay tables; `attacker_account_id` /
      `target_account_id` on `replay_combat_log`; `parser_version` 3
- [x] Parser: stamp `account_id` from `m_iPlayerSteamID`; slot = team
      slot (0–4 / 5–9), not discovery order; combat-log name suffixes
      (`_illusion`); SayText2 via player name; keep refreshing steam ids
- [x] Live ticks: resolve scoreboard row → roster `account_id` + Valve
      `player_slot` (GetLiveLeagueGames scoreboard often has `account_id = 0`)
- [x] Memory: `sink.Flusher` at 8192 for combat / actions / intervals;
      abort unpublished `parse_run_id` on decode error after a flush
- [x] Perf: consume unused entity bitstreams without storing trees
      (creeps, projectiles, particles). That is the Source 2 world cost.
- [x] Tests: identity helpers, live-tick join, keep-class; demo parse
      still fills combat + intervals
