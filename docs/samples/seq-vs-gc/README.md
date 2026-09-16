# Seq-num vs GC match details

Live dump of **one match** from both sources, 2026-09-12.

| | |
|---|---|
| Match | `8993362398` (league `17599`, 2026-09-11) |
| Seq file | [`match-8993362398-seq.json`](./match-8993362398-seq.json) |
| GC file | [`match-8993362398-gc.json`](./match-8993362398-gc.json) |

**Seq** is the raw `GetMatchHistoryBySequenceNum` match object (same shape as the old `GetMatchDetails`).

**GC** is our decode of `CMsgGCMatchDetailsResponse` (`result` + locator + `CMsgDOTAMatch`). `undefined` proto fields are omitted. Empty arrays / zeros that Valve sent stay in the file.

---

## Shared scalars (same values)

| Field | Both |
|---|---|
| `match_id` | 8993362398 |
| `duration` | 477 |
| `pre_game_duration` | 90 |
| `start_time` | 1789134336 |
| `cluster` | 274 |
| `first_blood_time` | 35 |
| `lobby_type` | 1 |
| `human_players` | 10 |
| `leagueid` | 17599 |
| `game_mode` | 2 |
| `engine` | 1 |
| `radiant_score` / `dire_score` | 13 / 3 |
| tower / barracks bitmasks | 2047 / 2046 / 63 / 63 |
| `picks_bans` heroes | 24 rows, same heroes and sides |

Box-score KDA, GPM/XPM, items `0..5`, gold, net worth, scaled damage match on player 0 (`account_id` 1593315139).

---

## Seq only

| Field | This dump | Notes |
|---|---|---|
| `match_seq_num` | `7555836622` | GC proto has field 33; Valve did not send it |
| `radiant_win` | `true` | GC has `match_outcome` `2` (radiant victory) instead |
| `radiant_captain` / `dire_captain` | account ids | not on `CMsgDOTAMatch` |
| `flags` | `5` | same bits as GC `match_flags` |
| `hero_variant` | `0` | GC name is `selected_facet` |
| `backpack_0..2` | e.g. `16, 42, 16` | GC `item_6..8` |
| `item_neutral` / `item_neutral2` | `0` | GC `item_9` / `item_10` |
| `aghanims_scepter` / `shard` / `moonshard` | `0` | not on the GC player proto |
| `ability_upgrades[]` | timed `{ability, time, level}` | **GC array was empty** on this match |

No `replay_salt`. Cannot build a replay URL from seq alone.

---

## GC only

| Field | This dump | Notes |
|---|---|---|
| `result` | `1` | wrapper `EResult` |
| `replay_salt` | `1802756158` | locator |
| `replay_state` | `0` (available) | |
| `match_outcome` | `2` | derives `radiant_win` |
| `match_flags` | `5` | seq `flags` |
| `series_id` / `series_type` | `0` / `0` | present, empty |
| `player_name` | e.g. `"♠LoNeLy WoLf♠"` | seq has no persona |
| `item_6..10`, `item_10_lvl` | backpack + extras | |
| `hero_pick_order` | `7` | |
| `hero_was_randomed` | `false` | |
| `hero_damage_received` / `dealt` | pre/post by type | |
| `seconds_dead`, `gold_lost_to_death` | | |
| `lane_selection_flags`, `bounty_runes`, `outposts_captured` | `0` | |
| `disable_duration`, `party_id` | `0` | |
| `permanent_buffs`, `additional_units`, `coaches`, `broadcaster_channels` | `[]` | |

Team name / logo / tag / guild / tournament keys exist on the proto; Valve omitted them here so they are not in the JSON.

`picks_bans` has no `order` field. Sequence is array index (seq sends `order` 0..23).

---

## Player slot 0 side by side

| | Seq | GC |
|---|---|---|
| items 0–5 | 151, 13, 13, 73, 29, 244 | same |
| backpack | `backpack_0..2` = 16, 42, 16 | `item_6..8` = 16, 42, 16 |
| neutrals | `item_neutral*` = 0 | `item_9` / `item_10` = 0 |
| kills / LH / GPM / NW | 5 / 51 / 540 / 4837 | same |
| ability upgrades | 8 timed rows | `[]` |
| name | — | `player_name` |
| facet | `hero_variant` 0 | `selected_facet` 0 |
| damage split | — | received / dealt by type |

---

## What to persist from which

- **History (`GetMatchHistory`)** — `match_id`, `match_seq_num`, series/teams listing.
- **Seq (`GetMatchHistoryBySequenceNum`)** — box score, draft, backpack, timed `ability_upgrades`, captains. No salt.
- **GC** — box score, draft, cluster/salt, flags/outcome, extra player stats. Map `item_6..8` → backpack.
- **Replay metadata** — leftover captains / backpack / neutrals / Aghs if seq and GC left them empty, timed skill build if both sent none.
