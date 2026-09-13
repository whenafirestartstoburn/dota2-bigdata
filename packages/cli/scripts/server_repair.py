#!/usr/bin/env python3
"""One-off server repairs: barracks from CH, league details via seq-num, buyback check."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from typing import Any
from urllib.parse import urlencode

PG = [
    "docker",
    "exec",
    "-i",
    "dota2-bigdata-postgres-1",
    "psql",
    "-U",
    "dota",
    "-d",
    "dota",
    "-v",
    "ON_ERROR_STOP=1",
]
CH = [
    "docker",
    "exec",
    "-i",
    "dota2-bigdata-clickhouse-1",
    "clickhouse-client",
    "--user",
    "dota",
    "--password",
    "dota",
]


def sh(cmd: list[str], inp: str | None = None) -> str:
    return subprocess.check_output(cmd, input=inp, text=True)


def pg(sql: str) -> str:
    return sh(PG + ["-t", "-A", "-F", "\t"], inp=sql)


def pg_exec(sql: str) -> None:
    sh(PG + ["-q"], inp=sql)


def ch(sql: str) -> str:
    return sh(CH + ["--query", sql])


def sql_lit(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not value.is_integer():
            return repr(value)
        return str(int(value) if isinstance(value, float) else value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def rax_bit(name: str) -> tuple[bool, int] | None:
    n = name.lower()
    if "rax" not in n and "barracks" not in n:
        return None
    dire = "badguys" in n or "dire" in n
    ranged = "range" in n
    lane = 0
    if "mid" in n:
        lane = 2
    elif "bot" in n:
        lane = 4
    bit = 1 << lane
    if ranged:
        bit <<= 1
    return dire, bit


def infer_lane(samples: list[tuple[float, float]], team: int) -> tuple[int, int, bool]:
    if len(samples) < 4:
        return 0, 0, False
    mid = top = bot = jungle = 0
    for x, y in samples:
        dx, dy = x - 128, y - 128
        if dx * dx + dy * dy < 18 * 18:
            mid += 1
            continue
        if 90 < x < 160 and 90 < y < 160 and dx * dx + dy * dy > 22 * 22:
            jungle += 1
        if y > x:
            top += 1
        else:
            bot += 1
    n = len(samples)
    if jungle * 3 > n:
        return 4, 4, True
    if mid * 2 > n:
        return 2, 2, False
    if team == 2:
        return (1, 1, False) if bot >= top else (3, 3, False)
    return (1, 1, False) if top >= bot else (3, 3, False)


def cmd_barracks() -> None:
    ids = [
        int(x)
        for x in pg(
            "SELECT match_id FROM match_replays WHERE status = 'parsed' ORDER BY 1"
        ).splitlines()
        if x.strip()
    ]
    updated = 0
    for i in range(0, len(ids), 80):
        chunk = ids[i : i + 80]
        listed = ",".join(str(x) for x in chunk)
        raw = ch(
            "SELECT match_id, target, attacker FROM dota.replay_combat_log "
            f"WHERE match_id IN ({listed}) "
            "AND type IN ('DEATH','TEAM_BUILDING_KILL') "
            "AND (target LIKE '%rax%' OR attacker LIKE '%rax%' "
            "OR target LIKE '%barracks%' OR attacker LIKE '%barracks%')"
        )
        by_match: dict[int, tuple[int, int]] = {
            mid: (63, 63) for mid in chunk
        }
        seen: set[int] = set()
        for line in raw.splitlines():
            if not line.strip():
                continue
            mid_s, target, attacker = (line.split("\t") + ["", ""])[:3]
            mid = int(mid_s)
            rad, dire = by_match.get(mid, (63, 63))
            for name in (target, attacker):
                hit = rax_bit(name)
                if hit is None:
                    continue
                is_dire, bit = hit
                seen.add(mid)
                if is_dire:
                    dire &= ~bit
                else:
                    rad &= ~bit
            by_match[mid] = (rad, dire)
        parts = []
        for mid in seen:
            rad, dire = by_match[mid]
            parts.append(
                f"({mid},{rad},{dire})"
            )
        if not parts:
            continue
        pg_exec(
            "UPDATE matches AS m SET "
            "barracks_status_radiant = v.rad, "
            "barracks_status_dire = v.dire, "
            "updated_at = now() "
            "FROM (VALUES "
            + ",".join(parts)
            + ") AS v(match_id, rad, dire) "
            "WHERE m.match_id = v.match_id"
        )
        updated += len(parts)
        print(json.dumps({"barracks_chunk": i, "updated": updated}), flush=True)
    print(json.dumps({"barracks_done": True, "updated": updated}))


def cmd_lanes() -> None:
    ids = [
        int(x)
        for x in pg(
            "SELECT DISTINCT match_id FROM match_players "
            "WHERE (lane IS NULL OR lane = 0) "
            "AND match_id IN (SELECT match_id FROM match_replays WHERE status = 'parsed') "
            "ORDER BY 1"
        ).splitlines()
        if x.strip()
    ]
    filled = 0
    for i in range(0, len(ids), 40):
        chunk = ids[i : i + 40]
        listed = ",".join(str(x) for x in chunk)
        raw = ch(
            "SELECT match_id, slot, x, y FROM dota.replay_intervals "
            f"WHERE match_id IN ({listed}) AND time >= 0 AND time <= 600 "
            "AND (x != 0 OR y != 0)"
        )
        samples: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
        for line in raw.splitlines():
            if not line.strip():
                continue
            mid_s, slot_s, x_s, y_s = line.split("\t")
            samples[(int(mid_s), int(slot_s))].append((float(x_s), float(y_s)))
        updates = []
        for (mid, slot), pts in samples.items():
            team = 2 if slot < 5 else 3
            lane, role, roam = infer_lane(pts, team)
            if lane == 0:
                continue
            valve_slot = slot if slot < 5 else 128 + (slot - 5)
            updates.append(
                f"({mid},{valve_slot},{lane},{role},{'TRUE' if roam else 'FALSE'})"
            )
        if not updates:
            continue
        pg_exec(
            "UPDATE match_players AS p SET "
            "lane = v.lane, lane_role = v.role, is_roaming = v.roam, "
            "updated_at = now() "
            "FROM (VALUES "
            + ",".join(updates)
            + ") AS v(match_id, player_slot, lane, role, roam) "
            "WHERE p.match_id = v.match_id AND p.player_slot = v.player_slot "
            "AND (p.lane IS NULL OR p.lane = 0)"
        )
        filled += len(updates)
        print(json.dumps({"lane_chunk": i, "filled": filled}), flush=True)
    print(json.dumps({"lanes_done": True, "filled": filled}))


def steam_get(url: str, proxy: str | None) -> dict[str, Any]:
    handlers: list[urllib.request.BaseHandler] = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers={"User-Agent": "dota2-collector/repair"})
    with opener.open(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def load_steam() -> tuple[str, str | None]:
    row = pg(
        "SELECT k.api_key, p.url "
        "FROM steam_api_keys k "
        "LEFT JOIN proxies p ON p.id = k.proxy_id "
        "WHERE k.status IN ('ready','active','rate_limited') "
        "AND (k.rate_limited_until IS NULL OR k.rate_limited_until < now()) "
        "ORDER BY k.last_used_at NULLS FIRST LIMIT 1"
    ).strip()
    if not row:
        raise SystemExit("no steam api key")
    parts = row.split("\t")
    key = parts[0]
    proxy = parts[1] if len(parts) > 1 and parts[1] else None
    return key, proxy


def persist_match(raw: dict[str, Any]) -> None:
    mid = int(raw["match_id"])
    start = raw.get("start_time")
    duration = raw.get("duration")
    finished = None
    if start and duration:
        finished = int(start) + int(duration)
    team = raw.get("radiant_team_id")
    dire_team = raw.get("dire_team_id")
    pg_exec(
        f"""
        INSERT INTO teams (team_id, name, tag, updated_at, created_at)
        SELECT {sql_lit(team)}, {sql_lit(raw.get("radiant_name") or raw.get("radiant_team_name") or str(team))},
               {sql_lit(raw.get("radiant_team_tag"))}, now(), now()
        WHERE {sql_lit(team)} IS NOT NULL AND {sql_lit(team)}::int > 0
        ON CONFLICT (team_id) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, teams.name),
          updated_at = now();
        INSERT INTO teams (team_id, name, tag, updated_at, created_at)
        SELECT {sql_lit(dire_team)}, {sql_lit(raw.get("dire_name") or raw.get("dire_team_name") or str(dire_team))},
               {sql_lit(raw.get("dire_team_tag"))}, now(), now()
        WHERE {sql_lit(dire_team)} IS NOT NULL AND {sql_lit(dire_team)}::int > 0
        ON CONFLICT (team_id) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, teams.name),
          updated_at = now();
        UPDATE matches SET
          match_seq_num = COALESCE({sql_lit(raw.get("match_seq_num"))}, match_seq_num),
          duration = COALESCE({sql_lit(duration)}, duration),
          start_time = COALESCE({sql_lit(start)}, start_time),
          radiant_win = COALESCE({sql_lit(raw.get("radiant_win"))}, radiant_win),
          radiant_score = COALESCE({sql_lit(raw.get("radiant_score"))}, radiant_score),
          dire_score = COALESCE({sql_lit(raw.get("dire_score"))}, dire_score),
          tower_status_radiant = COALESCE({sql_lit(raw.get("tower_status_radiant"))}, tower_status_radiant),
          tower_status_dire = COALESCE({sql_lit(raw.get("tower_status_dire"))}, tower_status_dire),
          barracks_status_radiant = COALESCE({sql_lit(raw.get("barracks_status_radiant"))}, barracks_status_radiant),
          barracks_status_dire = COALESCE({sql_lit(raw.get("barracks_status_dire"))}, barracks_status_dire),
          first_blood_time = COALESCE({sql_lit(raw.get("first_blood_time"))}, first_blood_time),
          lobby_type = COALESCE({sql_lit(raw.get("lobby_type"))}, lobby_type),
          game_mode = COALESCE({sql_lit(raw.get("game_mode"))}, game_mode),
          human_players = COALESCE({sql_lit(raw.get("human_players"))}, human_players),
          cluster = COALESCE({sql_lit(raw.get("cluster"))}, cluster),
          replay_salt = COALESCE({sql_lit(raw.get("replay_salt"))}, replay_salt),
          radiant_team_id = COALESCE({sql_lit(team)}, radiant_team_id),
          dire_team_id = COALESCE({sql_lit(dire_team)}, dire_team_id),
          radiant_team_name = COALESCE({sql_lit(raw.get("radiant_name") or raw.get("radiant_team_name"))}, radiant_team_name),
          dire_team_name = COALESCE({sql_lit(raw.get("dire_name") or raw.get("dire_team_name"))}, dire_team_name),
          seq_fetched_at = COALESCE(seq_fetched_at, now()),
          patch = COALESCE(patch, (
            SELECT patch FROM patches
            WHERE released_at <= to_timestamp({sql_lit(start)})
            ORDER BY released_at DESC LIMIT 1
          )),
          finished_at = COALESCE(finished_at, to_timestamp({sql_lit(finished)})),
          updated_at = now()
        WHERE match_id = {mid};
        """
    )
    players = raw.get("players") or []
    for p in players:
        if not isinstance(p, dict):
            continue
        slot = p.get("player_slot")
        if slot is None:
            continue
        slot = int(slot)
        if 5 <= slot <= 9:
            slot = 128 + (slot - 5)
        acc = p.get("account_id")
        if acc is None:
            acc = 0
        side = "radiant" if slot < 128 else "dire"
        pg_exec(
            f"""
            INSERT INTO match_players (
              match_id, account_id, player_slot, hero_id, player_name, side,
              kills, deaths, assists, last_hits, denies, gold, gold_spent,
              gold_per_min, xp_per_min, net_worth, level,
              hero_damage, tower_damage, hero_healing,
              item_0, item_1, item_2, item_3, item_4, item_5,
              leaver_status, updated_at
            ) VALUES (
              {mid}, {sql_lit(acc)}, {slot}, {sql_lit(p.get("hero_id") or 0)},
              {sql_lit(p.get("personaname") or p.get("player_name"))},
              {sql_lit(side)},
              {sql_lit(p.get("kills"))}, {sql_lit(p.get("deaths"))},
              {sql_lit(p.get("assists"))}, {sql_lit(p.get("last_hits"))},
              {sql_lit(p.get("denies"))}, {sql_lit(p.get("gold"))},
              {sql_lit(p.get("gold_spent"))}, {sql_lit(p.get("gold_per_min"))},
              {sql_lit(p.get("xp_per_min"))}, {sql_lit(p.get("net_worth"))},
              {sql_lit(p.get("level"))}, {sql_lit(p.get("hero_damage"))},
              {sql_lit(p.get("tower_damage"))}, {sql_lit(p.get("hero_healing"))},
              {sql_lit(p.get("item_0"))}, {sql_lit(p.get("item_1"))},
              {sql_lit(p.get("item_2"))}, {sql_lit(p.get("item_3"))},
              {sql_lit(p.get("item_4"))}, {sql_lit(p.get("item_5"))},
              {sql_lit(p.get("leaver_status"))}, now()
            )
            ON CONFLICT (match_id, player_slot) DO UPDATE SET
              account_id = EXCLUDED.account_id,
              hero_id = EXCLUDED.hero_id,
              player_name = COALESCE(EXCLUDED.player_name, match_players.player_name),
              side = EXCLUDED.side,
              kills = COALESCE(EXCLUDED.kills, match_players.kills),
              deaths = COALESCE(EXCLUDED.deaths, match_players.deaths),
              assists = COALESCE(EXCLUDED.assists, match_players.assists),
              last_hits = COALESCE(EXCLUDED.last_hits, match_players.last_hits),
              denies = COALESCE(EXCLUDED.denies, match_players.denies),
              gold = COALESCE(EXCLUDED.gold, match_players.gold),
              gold_spent = COALESCE(EXCLUDED.gold_spent, match_players.gold_spent),
              gold_per_min = COALESCE(EXCLUDED.gold_per_min, match_players.gold_per_min),
              xp_per_min = COALESCE(EXCLUDED.xp_per_min, match_players.xp_per_min),
              net_worth = COALESCE(EXCLUDED.net_worth, match_players.net_worth),
              level = COALESCE(EXCLUDED.level, match_players.level),
              hero_damage = COALESCE(EXCLUDED.hero_damage, match_players.hero_damage),
              tower_damage = COALESCE(EXCLUDED.tower_damage, match_players.tower_damage),
              hero_healing = COALESCE(EXCLUDED.hero_healing, match_players.hero_healing),
              item_0 = COALESCE(EXCLUDED.item_0, match_players.item_0),
              item_1 = COALESCE(EXCLUDED.item_1, match_players.item_1),
              item_2 = COALESCE(EXCLUDED.item_2, match_players.item_2),
              item_3 = COALESCE(EXCLUDED.item_3, match_players.item_3),
              item_4 = COALESCE(EXCLUDED.item_4, match_players.item_4),
              item_5 = COALESCE(EXCLUDED.item_5, match_players.item_5),
              leaver_status = COALESCE(EXCLUDED.leaver_status, match_players.leaver_status),
              updated_at = now();
            """
        )
        if int(acc) > 0 and int(acc) < 4294967295:
            pg_exec(
                f"""
                INSERT INTO players (account_id, persona_name, is_pro, updated_at, created_at)
                VALUES ({sql_lit(acc)}, {sql_lit(p.get("personaname") or p.get("player_name"))}, TRUE, now(), now())
                ON CONFLICT (account_id) DO UPDATE SET
                  persona_name = COALESCE(EXCLUDED.persona_name, players.persona_name),
                  is_pro = players.is_pro OR EXCLUDED.is_pro,
                  updated_at = now();
                """
            )
    picks = raw.get("picks_bans") or []
    if picks:
        pg_exec(f"DELETE FROM match_draft WHERE match_id = {mid}")
        for i, row in enumerate(picks):
            if not isinstance(row, dict):
                continue
            hero = row.get("hero_id")
            if not hero:
                continue
            team_n = int(row.get("team") or 0)
            if team_n in (2, 3):
                team_n = 0 if team_n == 2 else 1
            is_pick = row.get("is_pick")
            if isinstance(is_pick, (int, float)):
                is_pick = bool(is_pick)
            pg_exec(
                f"""
                INSERT INTO match_draft (match_id, ord, is_pick, hero_id, team, clock)
                VALUES ({mid}, {int(row.get("order") if row.get("order") is not None else i)},
                        {sql_lit(bool(is_pick))}, {int(hero)}, {team_n}, NULL)
                """
            )


def cmd_ingest(league_id: int, limit: int = 0) -> None:
    key, proxy = load_steam()
    q = (
        "SELECT match_id, match_seq_num FROM matches "
        f"WHERE league_id = {league_id} AND match_seq_num IS NOT NULL "
        "AND duration IS NULL ORDER BY match_seq_num"
    )
    if limit > 0:
        q += f" LIMIT {limit}"
    rows = [
        line.split("\t")
        for line in pg(q).splitlines()
        if line.strip()
    ]
    want = {int(m): int(s) for m, s in rows}
    print(json.dumps({"pending": len(want), "proxy": bool(proxy)}), flush=True)
    remaining = set(want)
    seqs = sorted(set(want.values()))
    saved = 0
    calls = 0
    for start in seqs:
        if not remaining:
            break
        if not any(want[mid] >= start for mid in remaining):
            continue
        qs = urlencode(
            {
                "key": key,
                "start_at_match_seq_num": start,
                "matches_requested": 25,
            }
        )
        url = (
            "https://api.steampowered.com/IDOTA2Match_570/"
            f"GetMatchHistoryBySequenceNum/v1/?{qs}"
        )
        try:
            body = steam_get(url, proxy)
        except Exception as err:
            print(json.dumps({"seq": start, "error": str(err)[:200]}), flush=True)
            time.sleep(2)
            continue
        calls += 1
        matches = ((body.get("result") or {}).get("matches")) or []
        for raw in matches:
            mid = int(raw.get("match_id") or 0)
            if mid not in remaining:
                continue
            persist_match(raw)
            remaining.discard(mid)
            saved += 1
            print(json.dumps({"saved": mid, "left": len(remaining)}), flush=True)
        time.sleep(0.35)
    print(json.dumps({"ingest_done": True, "calls": calls, "saved": saved, "missing": len(remaining)}))


def cmd_replays(league_id: int, limit: int = 8) -> None:
    rows = [
        line.split("\t")
        for line in pg(
            "SELECT match_id, cluster, replay_salt FROM matches "
            f"WHERE league_id = {league_id} AND cluster IS NOT NULL "
            "AND replay_salt IS NOT NULL ORDER BY match_id "
            f"LIMIT {limit}"
        ).splitlines()
        if line.strip()
    ]
    out = []
    for mid_s, cluster_s, salt_s in rows:
        mid, cluster, salt = int(mid_s), int(cluster_s), int(salt_s)
        url = f"http://replay{cluster}.valve.net/570/{mid}_{salt}.dem.bz2"
        status = "error"
        try:
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=20) as resp:
                status = str(resp.status)
        except urllib.error.HTTPError as err:
            status = str(err.code)
        except Exception as err:
            status = str(err)[:80]
        out.append({"match_id": mid, "status": status, "url": url})
        print(json.dumps(out[-1]), flush=True)
    print(json.dumps({"replay_probe": out}))


def cmd_buybacks(league_id: int) -> None:
    ours = pg(
        """
        SELECT
          COALESCE(p.persona_name, mp.pro_name, mp.player_name, mp.account_id::text) AS name,
          AVG(COALESCE(bb.n, 0)) AS avg_bb,
          COUNT(DISTINCT m.match_id) AS matches,
          SUM(COALESCE(bb.n, 0)) AS sum_bb,
          MIN(COALESCE(bb.n, 0)) AS min_bb,
          MAX(COALESCE(bb.n, 0)) AS max_bb
        FROM matches m
        JOIN match_players mp ON mp.match_id = m.match_id
        LEFT JOIN players p ON p.account_id = mp.account_id
        LEFT JOIN (
          SELECT match_id, slot, COUNT(*) AS n
          FROM match_objectives
          WHERE kind = 'buyback'
          GROUP BY 1, 2
        ) bb ON bb.match_id = mp.match_id
          AND bb.slot = CASE WHEN mp.player_slot >= 128 THEN mp.player_slot - 128 + 5 ELSE mp.player_slot END
        WHERE m.league_id = %d AND m.duration IS NOT NULL
        GROUP BY 1
        ORDER BY avg_bb DESC, matches DESC
        LIMIT 30
        """
        % league_id
    )
    print(ours)
    print(json.dumps({"our_rows": len([x for x in ours.splitlines() if x.strip()])}))


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: server_repair.py barracks|lanes|ingest|replays|buybacks [league] [limit]")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "barracks":
        cmd_barracks()
    elif cmd == "lanes":
        cmd_lanes()
    elif cmd == "ingest":
        cmd_ingest(int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 0)
    elif cmd == "replays":
        cmd_replays(int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 8)
    elif cmd == "buybacks":
        cmd_buybacks(int(sys.argv[2]))
    else:
        raise SystemExit(cmd)


if __name__ == "__main__":
    main()
