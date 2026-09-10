# Replay event → ClickHouse mapping

Companions: [`demo-file.md`](./demo-file.md) (wire),
[`data-schema.md`](./data-schema.md), [`replay-parser.md`](./replay-parser.md).

This is the catalog of what a parsed `.dem` becomes. The Go extract
(`packages/parser/internal/parse`) writes only these tables. Re-parse is
always possible: the file stays in S3.

`parser_version` **3** stamps `account_id` on every `replay_*` row.
Version 2 added `replay_alerts` and interval vitals. Filter
`replay_*.parser_version` / join `match_replays.parse_run_id` as the
commit spec already said.

---

## Shared prefix

Every `replay_*` row:

| Column | Meaning |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC); partition key |
| `time` | Game clock seconds; negative in pregame |
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

Every scalar on `CMsgDOTACombatLogEntry` is a column (see
`db/clickhouse/schema.sql`). `greevils_greed_stack` / `tracked_death` /
`tracked_sourcename` are leftover defaults (not on the proto); do not
read them.

String names resolve through the `CombatLogNames` string table.

---

## 1 Hz snapshot → `replay_intervals`

Source: `CDOTA_PlayerResource` + `CDOTA_DataRadiant` / `CDOTA_DataDire`
+ the hero entity, once per second after the clock is valid.

| Column | Source field (typical) |
|---|---|
| `hero_id`, `variant`, `facet_hero_id` | `m_nSelectedHeroID`, `m_iHeroFacetKey` |
| `x`, `y` | hero origin |
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
samples, not stored as a CH series.

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

Gamerules pick/ban arrays while `m_nGameState == 2`, then
`CDemoFileInfo` picks/bans if the live arrays were empty.

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

## Epilogue → `replay_epilogue`

Key/value leftovers from `CDemoFileInfo` and `DOTA_UM_MatchMetadata`.
Not a query surface: winner / teams also exist on Postgres `matches`.
`match_metadata` is the JSON of `CDOTAMatchMetadata` (graphs Valve
already computed). Prefer typed tables above for anything we named.

| `key` | Source |
|---|---|
| `playback_time` / `playback_ticks` / `playback_frames` | file info |
| `match_id`, `game_winner`, `radiant_team_id`, `dire_team_id` | `CGameInfo.dota` |
| `player_info`, `picks_bans` | file info JSON |
| `metadata_version`, `match_metadata` | match metadata file |

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
