# Demo file structure

Companions: [`replay-parser.md`](./replay-parser.md) (how we parse),
[`replay-mapping.md`](./replay-mapping.md) (what we store).

A Valve Dota 2 replay is a **Source 2 protobuf demo**: a binary recording of
the same network stream a spectator client would receive. It is not a
story of the match. Nothing in the file says “Mirana ganked top at 6:00”.
The file is a framed stream of schema, entity deltas, and typed messages.
Behaviour is reconstructed after the fact.

This document is the file itself. What we keep after parse lives in the
mapping spec.

## Official reference

Valve does **not** publish a standalone “Source 2 demo format” page. The
schema **is** the `.proto` files shipped in the game client. Those files
are the official contract.

The live dump (extracted from each Dota 2 update, not hand-written) is:

- [SteamDatabase/GameTracking-Dota2 `Protobufs/`](https://github.com/SteamDatabase/GameTracking-Dota2/tree/master/Protobufs)

The files that define a `.dem`:

| Proto | What it is |
|---|---|
| [`demo.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/demo.proto) | Outer container: `EDemoCommands`, `CDemoFileHeader`, `CDemoPacket`, `CDemoFileInfo` |
| [`netmessages.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/netmessages.proto) | Inner server messages (`svc_ServerInfo`, `svc_PacketEntities`, string tables, …) |
| [`networkbasetypes.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/networkbasetypes.proto) | Inner engine messages (`net_Tick`, spawn groups) |
| [`usermessages.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/usermessages.proto) | Generic Source 2 user messages (`UM_SayText2`, HUD, camera) |
| [`dota_usermessages.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/dota_usermessages.proto) | Dota user messages (combat log, chat, pings, orders, metadata) |
| [`dota_shared_enums.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/dota_shared_enums.proto) | `DOTA_COMBATLOG_TYPES`, `CMsgDOTACombatLogEntry` |
| [`dota_match_metadata.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/dota_match_metadata.proto) | `CDOTAMatchMetadataFile` (graphs Valve already computed) |
| [`gameevents.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/gameevents.proto) | Named Source 1-style game events (`dota_player_kill`, …) |

Our copy of those protos is `packages/parser/internal/valve/*.proto`.
Regenerate from GameTracking when Valve adds fields; do not invent
message layouts.

The only **encoding** spec that is officially documented is protobuf
itself: [varints and wire types](https://protobuf.dev/programming-guides/encoding/).
Outer frames and inner packet chunks use those varints. Entity field
paths and sendtable leaves are **not** protobuf — they are bit-packed
engine encodings whose constants live in the client, not in a Valve
whitepaper.

### What is *not* the Source 2 format

[Valve Developer Community: DEM Format](https://developer.valvesoftware.com/wiki/DEM_Format)
documents **Source 1** `HL2DEMO` (CS:GO, old TF2). That header, those
frame types, and the 260-byte strings do not apply to Dota Reborn.

Source 1 Dota (pre-Reborn) used `PBUFDEM\0` and
`DEM_IsCompressed = 112`. Source 2 uses `PBDEMS2\0` and
`DEM_IsCompressed = 64`. Community write-ups from 2014–2016 often still
describe the old flag. Trust `demo.proto` from the current client.

CS2 and Deadlock share the same **container** (`PBDEMS2` + `EDemoCommands`).
The inner Dota user messages and combat-log proto are Dota-only.

## Delivery wrapper

The Game Coordinator returns a CDN URL. The object is almost always
named `*.dem.bz2`. The **bytes** may be:

| Magic | Encoding |
|---|---|
| `BZh` | bzip2 |
| `28 b5 2f fd` | zstd (seen on current Valve CDN objects that still end in `.bz2`) |
| `PBDEMS2\0` | already uncompressed |

`packages/parser/internal/parse/demo.go` sniffs the first bytes and
unwraps. After that the stream is a Source 2 demo. League files are
typically 20–80 MB compressed; a casted game with voice is larger.

A local replay from the client is uncompressed:

`Steam/steamapps/common/dota 2 beta/game/dota/replays/<match_id>.dem`

## Container

```
offset 0..7    PBDEMS2\0
offset 8..11   uint32 LE  — byte offset of CDemoFileInfo (summary / footer)
offset 12..15  uint32 LE  — second engine hint (spawn-group / related offset)
offset 16..    outer command stream
```

The two uint32s are seek hints. A sequential parser can ignore them:
every command is self-framed. On match `8973166068` (patch 7.39) they
were `115305600` and `115305483` — near the end of the ~110 MB
uncompressed file, where `DEM_FileInfo` lives.

Our decoder (`packages/parser/internal/replay/session.go`) checks the
8-byte magic and skips the next 8 bytes.

### Outer command stream

After the 16-byte header the file is only this, repeated until
`DEM_Stop` or EOF:

```
command  varuint32   (kind | DEM_IsCompressed)
tick     varuint32   (0xFFFFFFFF means 0)
size     varuint32
payload  size bytes  (Snappy if the 0x40 bit was set)
```

`kind = command & ~64`. `64` is `EDemoCommands.DEM_IsCompressed` in
current `demo.proto`. Payload is then a protobuf message whose type is
the `CDemo*` for that kind.

Typical order at the start of a 7.39 replay:

1. `DEM_FileHeader` — recording metadata
2. several `DEM_SignonPacket` — join / spawn-group / server info
3. `DEM_Recovery` — spawn-group recovery (newer Source 2)
4. `DEM_SendTables` (Snappy) — flattened serializer schema
5. `DEM_ClassInfo` (Snappy) — class id → network name
6. `DEM_StringTables` (Snappy) — full string-table snapshot
7. `DEM_SyncTick` — signon done, playback begins
8. many `DEM_Packet` / occasional `DEM_FullPacket` — the match
9. `DEM_FileInfo` — duration, winner, players, picks/bans
10. `DEM_Stop`

`DEM_FullPacket` is a keyframe: a string-table snapshot plus a packet.
Seeking a replay jumps to the nearest full packet and replays deltas.

### `EDemoCommands` (current client)

| ID | Name | Role |
|---:|---|---|
| 0 | `DEM_Stop` | End of stream |
| 1 | `DEM_FileHeader` | Stamp, map, build, server |
| 2 | `DEM_FileInfo` | Playback length + `CGameInfo.dota` |
| 3 | `DEM_SyncTick` | Signon → playback boundary |
| 4 | `DEM_SendTables` | Flattened serializers (entity schema) |
| 5 | `DEM_ClassInfo` | Numeric class id → `CDOTA_…` name |
| 6 | `DEM_StringTables` | Full table dump |
| 7 | `DEM_Packet` | One tick of inner network messages |
| 8 | `DEM_SignonPacket` | Same payload as packet, during join |
| 9 | `DEM_ConsoleCmd` | Recorded console command |
| 10 | `DEM_CustomData` | Game-defined blob |
| 11 | `DEM_CustomDataCallbacks` | Custom-data registry |
| 12 | `DEM_UserCmd` | Recorded client input |
| 13 | `DEM_FullPacket` | String tables + packet keyframe |
| 14 | `DEM_SaveGame` | Embedded save |
| 15 | `DEM_SpawnGroups` | Spawn-group state |
| 16 | `DEM_AnimationData` | Animation samples |
| 17 | `DEM_AnimationHeader` | Animation-run metadata |
| 18 | `DEM_Recovery` | Recording recovery |
| 64 | `DEM_IsCompressed` | Flag, not a message |

`CDemoFileHeader` fields we actually see on a current Valve server
(match `8973166068`):

| Field | Example |
|---|---|
| `demo_file_stamp` | `PBDEMS2` |
| `patch_version` | `48` |
| `server_name` | `Valve Dota 2 Peru Server (srcds2012-lim1.381.44)` |
| `client_name` | `SourceTV Demo` |
| `map_name` | `start` (the lobby/load map; the play map is in `svc_ServerInfo`) |
| `game_directory` | `/opt/srcds/dota/dota_v6918/dota` — build `6918` is parsed from this path |
| `demo_version_name` | `valve_demo_2` |
| `build_num` | `10836` |
| `server_start_tick` | `451` |

`CDemoFileInfo` at the end carries `playback_time` / `playback_ticks` /
`playback_frames` and `CGameInfo.dota`: `match_id`, `game_mode`,
`game_winner`, `player_info` (hero, name, Steam id, team), `leagueid`,
`picks_bans`, team ids/tags, `end_time`. That summary is a fallback
when live gamerules arrays were empty; it is not the combat log.

## Inner packets

`CDemoPacket.data` is **not** one protobuf message. It is another framed
stream, now bit-oriented:

```
type_id   ubit_var
size      varuint32
payload   size bytes   (one NET / SVC / UM protobuf)
```

Valve pads the last byte. A reader that starts another message from
leftover bits will invent garbage. Our decoder stops when fewer than 14
bits remain (`session.go`).

Messages in one packet are **reordered** before dispatch. Tick, string
tables, and spawn-group load must land before `svc_PacketEntities`;
legacy game events wait until the world is updated. Same priority table
as manta (`example_projects/dotabuff-manta-parser/demo_packet.go`).

### Engine / server messages

| Family | Examples | Role |
|---|---|---|
| `NET_Messages` | `net_Tick`, `net_SignonState`, `net_SpawnGroup_*` | Clock and load |
| `SVC_Messages` | `svc_ServerInfo` (40), `svc_CreateStringTable` (44), `svc_UpdateStringTable` (45), `svc_PacketEntities` (55), `svc_UserMessage` (72) | World + envelopes |
| `EBaseUserMessages` | `UM_SayText2` (118), HUD, fade, shake | Generic Source UI |
| `EDotaUserMessages` | 464–636 | Dota facts and Dota UI |
| `EBaseGameEvents` | `GE_Source1LegacyGameEventList` / `GE_Source1LegacyGameEvent` | Named events with a runtime schema |

`svc_ServerInfo` gives `tick_interval` (usually `1/30`) and `max_classes`
(bits needed for a class id). `game_dir` repeats the build path.

`svc_UserMessage` is a wrapper: `{ msg_type, msg_data }`. The inner type
is an `UM_*` or `DOTA_UM_*` id. Dota combat log for Source 2 spectators
is **`DOTA_UM_CombatLogDataHLTV` (554)** → `CMsgDOTACombatLogEntry`, not
the older `DOTA_UM_CombatLogData` (468).

## Schema: sendtables and classes

Entities are not self-describing. Before any create, the file must
supply:

1. **`DEM_SendTables`** → `CSVCMsg_FlattenedSerializer`: symbol table +
   per-class field list (name, type, encoder, bit count, low/high).
   Types are engine strings (`float32`, `CHandle`, `CUtlVector`,
   `QAngle`, `HeroID_t`, …). Nested serializers become tables; leaves
   get a decoder (`packages/parser/internal/replay/decode.go`).
2. **`DEM_ClassInfo`**: `class_id` → `network_name` (`CDOTA_PlayerResource`,
   `CDOTA_Unit_Hero_Mirana`, `CDOTA_Item_BlinkDagger`, …).
3. **`instancebaseline` string table**: default bit-blob per class id.
   A newly created entity is baseline ⊕ first delta.

Field updates are **paths** through that serializer tree, Huffman-coded
with Valve’s op weights (`path.go`). Those weights are engine constants,
not in any `.proto`.

Build-specific encoder quirks exist (early Reborn, quantized floats).
Our `internal/replay/patch.go` applies the same class of fixes manta
does. That is why `game_directory` / `svc_ServerInfo.game_dir` matter:
`dota_v6918` selects the decoder profile.

## String tables

Created by `svc_CreateStringTable`, patched by `svc_UpdateStringTable`,
snapshotted by `DEM_StringTables` / `DEM_FullPacket`. Userdata may be
Snappy or `LZSS`. Tables we actually resolve:

| Table | Used for |
|---|---|
| `CombatLogNames` | Attacker / target / inflictor / item names on combat rows |
| `EntityNames` | Unit class fallback |
| `instancebaseline` | Entity create defaults |
| `userinfo` | Slot ↔ Steam id ↔ name (also in `CDOTA_PlayerResource`) |

Other tables exist (particles, sounds, modifiers, …) and are decoded
into the table set even when extract ignores them.

## The world: packet entities

`svc_PacketEntities.entity_data` is a bit stream of `updated_entries`
slots. Each slot:

1. index delta (`ubit_var` + 1)
2. 2-bit command
3. create: class id, 17-bit serial, unknown varint, then field paths
4. update: field paths on the existing entity
5. leave / delete: drop from PVS or destroy

An **entity** is one networked object: hero, creep, tower, ward, item,
wearable, `CDOTA_PlayerResource`, `CDOTAGamerulesProxy`,
`CDOTA_DataRadiant` / `CDOTA_DataDire`. Handles are
`(serial << 14) | index`. The parser keeps the current snapshot and
notifies extract on create / update / leave / delete.

This is the source of 1 Hz intervals (HP, mana, gold, XP, position),
draft arrays on gamerules, inventory handle changes, ward place/expire,
and cosmetics. It is a **state machine**, not an event log.

Entity classes extract watches (`parse/parser.go`):

| Class | Why |
|---|---|
| `CDOTA_PlayerResource` | Slot, Steam id, selected hero, K/D/A, level |
| `CDOTA_DataRadiant` / `CDOTA_DataDire` | Gold, LH, denies, networth, ward/stack/rune counts |
| `CDOTAGamerulesProxy` | `m_nGameState`, pick/ban arrays, clocks |
| `CDOTA_Unit_Hero_*` | Origin, HP/mana, items, abilities, life state |
| observer / sentry ward classes | `replay_wards` |
| `CDOTAWearableItem` | Cosmetics |
| `CDOTA_Item_*` (neutral / tier) | Neutral-item create |

Thousands of other classes (particles, props, wearables we do not
query) still occupy slots in the file.

## Typed Dota messages

These ride inside packets. They **are** events.

### Combat log

`CMsgDOTACombatLogEntry` (`dota_shared_enums.proto`). One message type,
~80 scalars, discriminator `type` = `DOTA_COMBATLOG_TYPES` (damage,
heal, modifier add/remove, death, ability, item, gold, XP, purchase,
buyback, game state, first blood, …). Names are indexes into
`CombatLogNames`. This is the complete mechanical history of the match.

Source 2 HLTV path: `DOTA_UM_CombatLogDataHLTV`. Some older patches
also emit bulk or Source 1 game-event combat; extract uses the HLTV
user message.

### Chat and announcements

| Wire | Meaning |
|---|---|
| `DOTA_UM_ChatMessage` | All-chat text (not team chat) |
| `DOTA_UM_ChatWheel` | Wheel id |
| `UM_SayText2` | Engine say |
| `DOTA_UM_ChatEvent` | `DOTA_CHAT_MESSAGE_*` (tower, roshan, aegis, glyph, …) |

Team chat is not in the public replay.

### Orders, pings, alerts

`DOTA_UM_SpectatorPlayerUnitOrders` is every issued order
(`dotaunitorder_t`, unit list, ability, target, position, queued).

Location / minimap pings are `DOTA_UM_LocationPing` and
`DOTA_UM_MinimapEvent`. Item / ability / courier / outpost / Roshan /
tormentor / glyph / radar / buyback / aghs / madstone alerts are
separate `DOTA_UM_*` ids (464–636). Catalog: replay-mapping
`replay_alerts`.

### Match metadata

`DOTA_UM_MatchMetadata` carries `CDOTAMatchMetadataFile`: Valve-computed
graphs, inventory snapshots, kill lists, predictions. We stash the JSON
on `replay_epilogue` and prefer typed combat / interval tables for
anything we named.

### Game events

Once per replay the server sends `CMsgSource1LegacyGameEventList`
(name + field schema). Later `CMsgSource1LegacyGameEvent` rows are
`eventid` + typed values (`dota_player_kill`, `npc_spawned`,
`entity_hurt`, pause, …). Overlaps combat log; we do not store the
legacy event stream.

## What the file contains that we do not treat as match facts

The demo is a **client reconstruction tape**. It also has:

- particles, projectiles, blood, unit animation (`TE_*`,
  `DOTA_UM_ParticleManager`)
- camera, HUD create/destroy, speeches, taunts, tips, votes
- voice (`svc_VoiceData`) — large, useless for analysis
- sounds (`CMsgSos*`, `svc_Sounds`)
- decals, lights, debug overlays, console commands
- custom-game HUD, tutorial, arcana progress, seasonal modes
- fog of war as seen by SourceTV (implicit in what entities enter PVS)

Those fire in the file. [`replay-mapping.md`](./replay-mapping.md)
lists what we drop.

## Layers, one picture

```
CDN object          .dem.bz2 or zstd (magic sniff)
  └─ PBDEMS2 file   16-byte header + command stream
       ├─ CDemoFileHeader / FileInfo / SendTables / ClassInfo / StringTables
       └─ CDemoPacket.data
            ├─ net_Tick, svc_ServerInfo, string tables
            ├─ svc_PacketEntities     → entity snapshot
            ├─ DOTA_UM_* / UM_*       → combat, chat, orders, metadata
            └─ GE_Source1Legacy*      → named game events
```

A parser is therefore three decoders, not one `Unmarshal`:

1. outer varint frames + optional Snappy
2. inner bit-framed protobufs
3. sendtable field paths on `entity_data`

## Worked example (fixture)

`packages/parser/testdata/demos/8973166068_276401451.dem.bz2` is zstd
despite the name. After decompress:

```
50 42 44 45 4d 53 32 00   PBDEMS2\0
80 4c de 06               FileInfo offset 115305600
8b 4b de 06               second hint 115305483
```

First outer frames (tick `0xFFFFFFFF` → 0):

| # | Kind | Compressed | Payload |
|---|---|---|---|
| 0 | `DEM_FileHeader` | no | 183 B |
| 1–5 | `DEM_SignonPacket` | no | 7 B … 107 KB |
| 6–7 | `DEM_Recovery` | no | 112 B, 6 B |
| 8 | `DEM_SignonPacket` | no | 10 B |
| 9 | `DEM_SendTables` | Snappy | 132 KB compressed |
| 10 | `DEM_ClassInfo` | Snappy | 51 KB compressed |
| 11 | `DEM_StringTables` | Snappy | 68 KB compressed |

Then the packet loop for the rest of the match.

## Community write-ups (not Valve)

Useful, but they drift. Prefer GameTracking protos when they disagree.

| Source | Notes |
|---|---|
| [skadistats/compendium ch. 1](https://github.com/skadistats/compendium/blob/master/chapters/01-the-demo-file.md) | Best prose on “stream of entity changes, not behaviour”. Source 1 magic / `DEM_IsCompressed = 112`. |
| [pbdems2 file-structure guide](https://docs.rs/pbdems2) | Current Source 2 container, shared with CS2 / Deadlock. |
| [gem-dota bits primer](https://whanyu1212.github.io/gem-dota/cookbook/bits-and-bytes-primer) | Byte-level `PBDEMS2` walkthrough. |
| [dotabuff/manta](https://github.com/dotabuff/manta) | Reference Go parser. Vendored here as `example_projects/dotabuff-manta-parser`. |
| [skadistats/clarity](https://github.com/skadistats/clarity) | Java. OpenDota’s parser (`example_projects/opendota-parser`) sits on it. |
| [dotabuff/yasha](https://github.com/dotabuff/yasha) | Source 1 only. |
| `example_projects/dota2-demo-parser/docs/manta-events/` | Callback catalog over manta (what exists in the file, not our schema). |

Our decoder does not import manta. Example projects are for callback
names and field paths.

## Where this lives in our tree

| Path | Role |
|---|---|
| `packages/parser/internal/valve/*.proto` | Official Valve schema |
| `packages/parser/internal/replay/session.go` | PBDEMS2 + outer/inner frames |
| `packages/parser/internal/replay/{tables,entity,path,decode}.go` | Sendtables, entities, field paths |
| `packages/parser/internal/parse/` | Extract → `replay_*` rows |
| `packages/parser/testdata/demos/` | Local `.dem.bz2` / zstd fixtures |
