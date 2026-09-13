# Replay event → ClickHouse mapping

Companions: [`demo-file.md`](./demo-file.md) (wire),
[`data-schema.md`](./data-schema.md), [`replay-parser.md`](./replay-parser.md).

This is the catalog of what a parsed `.dem` becomes. The Go extract
(`packages/parser/internal/parse`) writes only these tables. Re-parse is
always possible: the file stays in S3.

`parser_version` **4** stamps PURCHASE `value_name` from
`CombatLogNames[value]`, lane samples from resolved `CBodyComponent`
positions, and barracks bitmasks from rax kills. Version 3 stamped
`account_id` on every `replay_*` row. Version 2 added `replay_alerts`
and interval vitals. Filter `replay_*.parser_version` / join
`match_replays.parse_run_id` as the commit spec already said.

---

## Shared prefix

Every `replay_*` row:

| Column | Meaning |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC); partition key |
| `time` | Game clock seconds; negative in pregame. Combat log: proto `timestamp` (field 15) minus game-start when the stamp looks absolute (`> 1000`) |
| `tick` | Demo tick |
| `slot` | 0–9 (`Int8`); `-1` if unknown. Not Valve 128–132 |
| `account_id` | Steam 32-bit player; `0` if unknown / not a player |
| `parser_version` | Extract/schema revision of the binary |
| `parse_run_id` | Unpublished until `match_replays.parse_run_id` matches |

---

## Combat log → `replay_combat_log`

Source: `DOTA_UM_CombatLogDataHLTV` (`CMsgDOTACombatLogEntry`).
`type` is the enum name with `DOTA_COMBATLOG_` stripped. Unknown future
ids stay as `DOTA_COMBATLOG_{id}` (or the raw proto name). **No type is
dropped.**

| `type` | Typical `value` / names | Notes |
|---|---|---|
| `DAMAGE` | amount; `attacker`/`target`/`inflictor` | `damage_type`, `damage_category` |
| `HEAL` | amount | `heal_from_lifesteal`, `heal_from_regen`, `is_heal_save` |
| `MODIFIER_ADD` / `MODIFIER_REMOVE` | `inflictor` = modifier | duration / purge / aura flags |
| `DEATH` | | assists, `will_reincarnate`, building flags |
| `ABILITY` / `ABILITY_TRIGGER` | | `ability_level`, toggle on/off, stolen |
| `ITEM` | item name in `value_name` | |
| `LOCATION` | `location_x` / `location_y` | |
| `GOLD` / `ALLIED_GOLD` | amount; `gold_reason` | |
| `XP` | amount; `xp_reason` | |
| `PURCHASE` | item; also copied to `replay_inventory` (slot `-1`) when `time <= 90` | |
| `BUYBACK` | also PG `match_objectives.kind = buyback` | |
| `GAME_STATE` | Valve state id | used to latch game-start clock |
| `PLAYERSTATS` | | |
| `MULTIKILL` / `KILLSTREAK` / `END_KILLSTREAK` | | |
| `TEAM_BUILDING_KILL` | | also PG objective if tower/rax/fort/roshan |
| `FIRST_BLOOD` | also PG `first_blood` | |
| `MODIFIER_STACK_EVENT` | `stack_count` | |
| `NEUTRAL_CAMP_STACK` | `neutral_camp_type` | |
| `PICKUP_RUNE` | `rune_type` | |
| `REVEALED_INVISIBLE` | | |
| `HERO_SAVED` | | |
| `MANA_RESTORED` / `MANA_DAMAGE` | | |
| `HERO_LEVELUP` | | |
| `BOTTLE_HEAL_ALLY` | | |
| `ENDGAME_STATS` | | |
| `INTERRUPT_CHANNEL` | | |
| `AEGIS_TAKEN` | | |
| `PHYSICAL_DAMAGE_PREVENTED` | | |
| `UNIT_SUMMONED` | | |
| `ATTACK_EVADE` | | |
| `TREE_CUT` | | |
| `SUCCESSFUL_SCAN` | | |
| `BLOODSTONE_CHARGE` | | |
| `CRITICAL_DAMAGE` | | |
| `SPELL_ABSORB` | | |
| `UNIT_TELEPORTED` | | |
| `KILL_EATER_EVENT` | `kill_eater_event` | |
| `NEUTRAL_ITEM_EARNED` | also `replay_neutrals` when the name looks neutral | |
| `STAT_TRACKER_PLAYER` | `tracked_stat_id` | |

String names resolve through the `CombatLogNames` string table.

### `CMsgDOTACombatLogEntry` columns

Every stored proto scalar is a column. Bools become `UInt8` (`0`/`1`).
Name indexes become resolved strings. Three leftovers are **not** on
the proto and stay at default: `greevils_greed_stack`, `tracked_death`,
`tracked_sourcename`. Do not read them.

| Proto field | # | Column | Notes |
|---|---|---|---|
| `type` | 1 | `type` | `DOTA_COMBATLOG_` prefix stripped |
| `target_name` | 2 | `target` | CombatLogNames |
| `target_source_name` | 3 | `targetsourcename` | |
| `attacker_name` | 4 | `attacker` | |
| `damage_source_name` | 5 | `sourcename` | |
| `inflictor_name` | 6 | `inflictor` | also seeds `value_name` on `ITEM` / `BUYBACK` / `MODIFIER_*` |
| `is_attacker_illusion` | 7 | `attacker_illusion` | |
| `is_attacker_hero` | 8 | `attacker_hero` | |
| `is_target_illusion` | 9 | `target_illusion` | |
| `is_target_hero` | 10 | `target_hero` | |
| `is_visible_radiant` | 11 | `visible_radiant` | |
| `is_visible_dire` | 12 | `visible_dire` | |
| `value` | 13 | `value` | amount / item id / game-state id. On `PURCHASE` also indexes CombatLogNames → `value_name` |
| `health` | 14 | `health` | target HP after the event |
| `timestamp` | 15 | `time` **and** `timestamp_raw` | `timestamp_raw` = the float as sent. `time` = Int32 game clock (subtract game-start when `timestamp > 1000`) |
| `stun_duration` | 16 | `stun_duration` | |
| `slow_duration` | 17 | `slow_duration` | |
| `is_ability_toggle_on` | 18 | `is_ability_toggle_on` | |
| `is_ability_toggle_off` | 19 | `is_ability_toggle_off` | |
| `ability_level` | 20 | `ability_level` | |
| `location_x` | 21 | `location_x` | |
| `location_y` | 22 | `location_y` | |
| `gold_reason` | 23 | `gold_reason` | |
| `timestamp_raw` | 24 | — | **not stored.** CH `timestamp_raw` is proto field 15 |
| `modifier_duration` | 25 | `modifier_duration` | |
| `xp_reason` | 26 | `xp_reason` | |
| `last_hits` | 27 | `last_hits` | |
| `attacker_team` | 28 | `attacker_team` | `DOTA_GC_TEAM` |
| `target_team` | 29 | `target_team` | |
| `obs_wards_placed` | 30 | `obs_wards_placed` | |
| `assist_player0`…`3` | 31–34 | `assist_player0`…`3` | first four of `assist_players`; `0` if absent |
| `stack_count` | 35 | `stack_count` | |
| `hidden_modifier` | 36 | `hidden_modifier` | |
| `is_target_building` | 37 | `is_target_building` | |
| `neutral_camp_type` | 38 | `neutral_camp_type` | |
| `rune_type` | 39 | `rune_type` | |
| `assist_players` | 40 | `assist_players` | full array; also copied into `assist_player0`…`3` |
| `is_heal_save` | 41 | `is_heal_save` | |
| `is_ultimate_ability` | 42 | `is_ultimate_ability` | |
| `attacker_hero_level` | 43 | `attacker_hero_level` | |
| `target_hero_level` | 44 | `target_hero_level` | |
| `xpm` | 45 | `xpm` | |
| `gpm` | 46 | `gpm` | |
| `event_location` | 47 | `event_location` | |
| `target_is_self` | 48 | `target_is_self` | |
| `damage_type` | 49 | `damage_type` | |
| `invisibility_modifier` | 50 | `invisibility_modifier` | |
| `damage_category` | 51 | `damage_category` | |
| `networth` | 52 | `networth` | |
| `building_type` | 53 | `building_type` | |
| `modifier_elapsed_duration` | 54 | `modifier_elapsed_duration` | |
| `silence_modifier` | 55 | `silence_modifier` | |
| `heal_from_lifesteal` | 56 | `heal_from_lifesteal` | |
| `modifier_purged` | 57 | `modifier_purged` | |
| `spell_evaded` | 58 | `spell_evaded` | |
| `motion_controller_modifier` | 59 | `motion_controller_modifier` | |
| `long_range_kill` | 60 | `long_range_kill` | |
| `modifier_purge_ability` | 61 | `modifier_purge_ability` | |
| `modifier_purge_npc` | 62 | `modifier_purge_npc` | |
| `root_modifier` | 63 | `root_modifier` | |
| `total_unit_death_count` | 64 | `total_unit_death_count` | |
| `aura_modifier` | 65 | `aura_modifier` | |
| `armor_debuff_modifier` | 66 | `armor_debuff_modifier` | |
| `no_physical_damage_modifier` | 67 | `no_physical_damage_modifier` | |
| `modifier_ability` | 68 | `modifier_ability` | |
| `modifier_hidden` | 69 | `modifier_hidden` | |
| `inflictor_is_stolen_ability` | 70 | `inflictor_is_stolen_ability` | |
| `kill_eater_event` | 71 | `kill_eater_event` | |
| `unit_status_label` | 72 | `unit_status_label` | |
| `spell_generated_attack` | 73 | `spell_generated_attack` | |
| `at_night_time` | 74 | `at_night_time` | |
| `attacker_has_scepter` | 75 | `attacker_has_scepter` | |
| `neutral_camp_team` | 76 | `neutral_camp_team` | |
| `regenerated_health` | 77 | `regenerated_health` | |
| `will_reincarnate` | 78 | `will_reincarnate` | |
| `uses_charges` | 79 | `uses_charges` | |
| `tracked_stat_id` | 80 | `tracked_stat_id` | |
| `modifier_purged_duration` | 81 | `modifier_purged_duration` | |
| `heal_from_regen` | 82 | `heal_from_regen` | |

Derived, not on the proto: `slot` / `attacker_slot` / `target_slot`
(name → 0–9), `account_id` / `attacker_account_id` /
`target_account_id` (slot → Steam 32-bit), `value_name` (CombatLogNames).

---

## 1 Hz snapshot → `replay_intervals`

Source: `CDOTA_PlayerResource` + `CDOTA_DataRadiant` / `CDOTA_DataDire`
+ the hero entity, once per second after the clock is valid.

| Column | Source field (typical) |
|---|---|
| `hero_id`, `variant`, `facet_hero_id` | `m_nSelectedHeroID`, `m_iHeroFacetKey` |
| `x`, `y` | hero `CBodyComponent` cell+vec (serializers are bound after the full sendtable packet so nested `m_cellX` exists) |
| `gold`, `lh`, `xp`, `networth`, `denies` | `m_vecDataTeam` |
| `level`, `kills`, `deaths`, `assists` | `m_vecPlayerTeamData` |
| `life_state` | hero `m_lifeState` |
| `stuns`, ward/stack/rune/tower/roshan counts | `m_vecDataTeam` |
| `teamfight_participation`, `firstblood_claimed` | `m_vecPlayerTeamData` |
| `repicked`, `randomed`, `pred_vict` | `m_vecPlayerTeamData` |
| `draft_stage` | gamerules `m_nGameState` |
| `unit` | hero class name |
| `hp`, `max_hp` | `m_iHealth` / `m_iMaxHealth` |
| `mana`, `max_mana` | `m_flMana` / `m_flMaxMana` |
| `respawn` | seconds left from `m_flRespawnTime` |

Not stored on the interval (elsewhere or out of scope): per-slot items
(`replay_inventory` on change), courier, building HP time series.

Lane for PG `match_players` is derived after parse from pre-10:00 `(x,y)`
samples (at least 4), not stored as a CH series. Zero lanes with zero
interval `x,y` mean the body-component serializer was not bound.

---

## Orders → `replay_actions`

`DOTA_UM_SpectatorPlayerUnitOrders`. One row per order.

`order_type` is Valve `dotaunitorder_t`. `unit_index` is the first unit
in the list. `ability_id`, `target_index`, `pos_*`, `queued` as sent.

---

## Pings → `replay_pings`

| Wire | `ping_type` / coords |
|---|---|
| `DOTA_UM_LocationPing` | `CDOTAMsg_LocationPing.type`, `x`/`y`, `target` |
| `DOTA_UM_MinimapEvent` | `event_type`, `x`/`y`, target handle |

Ability / facet / innate / item alerts are **not** pings; they go to
`replay_alerts`.

---

## Wards → `replay_wards`

Entity create/leave on observer and sentry ward classes.

`kind` = `obs` / `sen`. `is_left` = 0 place, 1 expire/destroy.
`ehandle` is the entity index so place and leave join.

---

## Chat → `replay_chat`

| Wire | `kind` | `key` |
|---|---|---|
| `DOTA_UM_ChatMessage` | `chat` | text; `channel` = `channel_type` |
| `DOTA_UM_ChatWheel` | `chatwheel` | wheel message id |
| `UM_SayText2` | `chat` | `messagename`; `unit` = `param1` |

---

## Announcements → `replay_announcements`

`DOTA_UM_ChatEvent`. `kind` is the `DOTA_CHAT_MESSAGE` name
(`CHAT_MESSAGE_TOWER_KILL`, …). Unknown ids are stored, not dropped.

A **sparse** copy also lands in Postgres `match_objectives`:

| Chat / combat | PG `kind` |
|---|---|
| `CHAT_MESSAGE_TOWER_*` / combat death of tower | `tower` |
| `CHAT_MESSAGE_BARRACKS_KILL` / rax death | `barracks` |
| `CHAT_MESSAGE_ROSHAN_KILL` / roshan death | `roshan` |
| `CHAT_MESSAGE_AEGIS` | `aegis` |
| `CHAT_MESSAGE_AEGIS_STOLEN` | `aegis_stolen` |
| `CHAT_MESSAGE_DENIED_AEGIS` | `aegis_denied` |
| `CHAT_MESSAGE_FIRSTBLOOD` / combat `FIRST_BLOOD` | `first_blood` |
| `CHAT_MESSAGE_GLYPH_USED` | `glyph` |
| `CHAT_MESSAGE_SCAN_USED` | `scan` |
| pause / unpause family | `pause` |
| disconnect family | `disconnect` |
| `CHAT_MESSAGE_RECONNECT` | `reconnect` |
| combat `BUYBACK` | `buyback` |
| fort death | `win` |
| `CHAT_MESSAGE_COURIER_LOST` | `courier` |
| `CHAT_MESSAGE_SHRINE_KILLED` | `shrine` |
| observer/sentry ward killed | `ward` |
| `CHAT_MESSAGE_MINIBOSS_KILL` | `tormentor` |
| `CHAT_MESSAGE_SMOKE_ACTIVATED` | `smoke` |
| `CHAT_MESSAGE_BANNER_PLANTED` | `banner` |
| `DOTA_UM_OutpostCaptured` | `outpost` |

Hero kills, runes, wagers, and UI chatter stay in `replay_announcements`
only.

---

## Draft → `replay_draft` (+ PG `match_draft`)

Gamerules pick/ban arrays while `m_nGameState == 2` go to ClickHouse
`replay_draft` (the live timeline). `CDemoFileInfo` picks/bans are the
official ~24-row sequence.

Postgres `match_draft`: if details already wrote a complete sequence
(20–32 rows, ≥10 picks), **do not replace it** — only stamp `clock`
from the file-info / compact replay sequence. Replace only when the PG
row set is missing or incomplete (live provisional lists).

`is_pick`, `hero_id`, `team` (0 radiant / 1 dire), `ord`, `clock`,
`extra_time_*`.

---

## Skill build → `replay_ability_levels`

Hero `m_hAbilities` / `m_vecAbilities` on each interval. A row is
emitted when that slot’s level increases. `ability_id` is the ability
class or string-table name (not always the numeric Valve id).

---

## Inventory → `replay_inventory`

| When | `item_slot` |
|---|---|
| Combat `PURCHASE` with `time <= 90` | `-1` |
| Hero `m_hItems` handle change | 0–20 (backpack / stash included) |

`item_id` is the item class or name. Empty `item_id` on a later row
means that slot was cleared. `charges` / `secondary_charges` when the
item entity exists.

---

## Neutrals → `replay_neutrals`

| `kind` | Source |
|---|---|
| `purchase` | combat `PURCHASE` whose name looks like a tier/neutral item |
| `neutral_item` | create of `CDOTA_Item_*` whose class contains `neutral` / `tier` |
| `found` | `DOTA_UM_FoundNeutralItem` (`key`/`value` = item ability id); also `replay_alerts.kind = found_neutral` with `value2` = tier |

`is_neutral_active_drop` / `is_neutral_passive_drop` exist on the
table and stay `0` — extract does not set them.

---

## Cosmetics → `replay_cosmetics`

`CDOTAWearableItem` definition index + account id. Deduped per
`(account, item)`.

---

## Alerts → `replay_alerts`

Typed user messages that are match facts but are not combat, chat, or
orders. One generic row: `kind`, `player2`, `value`, `value2`, `x`, `y`,
`key`.

| `kind` | Wire | `value` / `value2` / coords |
|---|---|---|
| `item_alert` | `DOTA_UM_ItemAlert` | item id; `x`,`y` |
| `enemy_item_alert` | `DOTA_UM_EnemyItemAlert` | item id; `player2` = target |
| `will_purchase` | `DOTA_UM_WillPurchaseAlert` | item id; `value2` = gold left |
| `item_sold` | `DOTA_UM_ItemSold` | item id |
| `item_purchased` | `DOTA_UM_ItemPurchased` | item id (combat `PURCHASE` is the complete log) |
| `ability_ping` | `DOTA_UM_AbilityPing` | ability id; `value2` = ping type |
| `facet_ping` | `DOTA_UM_FacetPing` | facet hash |
| `innate_ping` | `DOTA_UM_InnatePing` | entity id |
| `ability_steal` | `DOTA_UM_AbilitySteal` | ability id; `value2` = level |
| `shared_cooldown` | `DOTA_UM_SharedCooldown` | `key` = name; `value` = cooldown×100 |
| `courier_killed` | `DOTA_UM_CourierKilledAlert` | gold; `player2` = killer; `value2` = team |
| `courier_left_fountain` | `DOTA_UM_CourierLeftFountainAlert` | |
| `outpost_captured` | `DOTA_UM_OutpostCaptured` | team; also PG `outpost` |
| `outpost_xp` | `DOTA_UM_OutpostGrantedXP` | team; `value2` = xp |
| `glyph_alert` | `DOTA_UM_GlyphAlert` | `value` = 1 if negative |
| `radar_alert` | `DOTA_UM_RadarAlert` | same |
| `buyback_alert` | `DOTA_UM_BuyBackStateAlert` | |
| `aghs_status` | `DOTA_UM_AghsStatusAlert` | type; `value2` flags scepter/shard |
| `neutral_camp` | `DOTA_UM_NeutralCampAlert` | camp type; `value2` = stacks |
| `roshan_timer` | `DOTA_UM_RoshanTimer` | |
| `tormentor_timer` | `DOTA_UM_TormentorTimer` | |
| `roshan_phase` | `DOTA_UM_SendRoshanSpectatorPhase` | phase; `value2` = length |
| `map_line` | `DOTA_UM_MapLine` | `x`,`y` |
| `ping_confirm` | `DOTA_UM_PingConfirmation` | icon; `x`,`y` |
| `give_item` | `DOTA_UM_GiveItem` | status |
| `madstone` | `DOTA_UM_MadstoneAlert` | type; `value2` = tier |
| `timer_alert` | `DOTA_UM_TimerAlert` | alert type |
| `found_neutral` | `DOTA_UM_FoundNeutralItem` | item id; `value2` = tier |

---

## Metadata → `replay_meta*`

`CDemoFileInfo` + `CDOTAMatchMetadata` (`DOTA_UM_MatchMetadata`). Typed
columns, not a JSON dump. `replay_epilogue` is gone.

| Table | Source |
|---|---|
| `replay_meta` | file playback_* + `CGameInfo.dota` winner/teams + metadata version / lobby |
| `replay_meta_teams` | `CDOTAMatchMetadata.Team` graphs + CM |
| `replay_meta_players` | `Team.Player` scalars, `ability_upgrades`, `level_up_times`, graphs |
| `replay_meta_kills` | `Team.kills` (`KillInfo`: type, victim, killers, time, bounty) |
| `replay_meta_player_kills` | `Team.Player.kills` (per-victim counts) |
| `replay_meta_purchases` | `Team.Player.items` (`item_id`, `purchase_time`) |
| `replay_meta_inventory` | `Team.Player.inventory_snapshot` |
| `replay_meta_tips` | `match_tips` |

`player_info` names are Postgres `match_players`. `picks_bans` still
merge into `replay_draft` / `match_draft`. Event / cavern / gem /
contract blobs are not stored.

---

## Intentionally not stored

These fire in the demo and are discarded. They are visual, tutorial,
arcana-progress, or private-coach UI — not match facts we would query.

Particles, projectiles, unit animation, blood impact, camera, HUD
create/destroy, speeches, taunts, tips, votes, booster state, high-five,
salute, gift, dice/coin, rock-paper-scissors, versus-scene, custom-game
HUD, monster-hunter event mode, killcam cosmetics, quests, surveys,
debug lines, light color, invalid command.

Teamfights are **not** a parser event. Cluster `DEATH` + `DAMAGE` in a
query (or a later materialized view).

Courier and building **time series** are not snapshotted; courier loss
and building kills are in combat log / alerts / objectives.

---

## Postgres written by the same parse

| Table | What |
|---|---|
| `match_objectives` | Sparse story rows (see announcements) |
| `match_draft` | `clock` / order upserted from `replay_draft` |
| `match_players` | lane, roaming, stun/TF/ward/stack/rune/tower/roshan/FB summaries |
| `match_replays` | `parsed`, `parser_version`, `parse_run_id` |
