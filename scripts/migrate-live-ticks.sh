#!/usr/bin/env bash
# Drain Postgres live_*_ticks into ClickHouse. Restart-safe: each id range
# is inserted to CH first, then deleted from PG. A re-run skips insert when
# CH already has that range and only deletes leftover PG rows.
#
# After deploy (CH tables exist, workers write new ticks to CH):
#   ssh olegr@dota2-bigdata
#   cd /var/www/dota2-bigdata
#   BATCH=100000 WORKERS=4 ./scripts/migrate-live-ticks.sh
set -euo pipefail

CH_CONTAINER=${CH_CONTAINER:-dota2-bigdata-clickhouse-1}
PG_CONTAINER=${PG_CONTAINER:-dota2-bigdata-postgres-1}
CH_USER=${CH_USER:-dota}
CH_PASSWORD=${CH_PASSWORD:-dota}
CH_DATABASE=${CH_DATABASE:-dota}
PG_USER=${PG_USER:-dota}
PG_PASSWORD=${PG_PASSWORD:-dota}
PG_DB=${PG_DB:-dota}
PG_CH_HOST=${PG_CH_HOST:-postgres}
BATCH=${BATCH:-100000}
WORKERS=${WORKERS:-4}

ch_query() {
	docker exec "$CH_CONTAINER" clickhouse-client \
		--user "$CH_USER" \
		--password "$CH_PASSWORD" \
		--database "$CH_DATABASE" \
		--query "$1"
}

pg_query() {
	docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
		-v ON_ERROR_STOP=1 -At -c "$1"
}

log() {
	printf '%s\n' "{\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",$1}"
}

die() {
	log "\"level\":\"error\",\"msg\":\"$1\""
	exit 1
}

preflight() {
	local table=$1
	local exists
	exists=$(ch_query "EXISTS TABLE ${table}")
	[[ "$exists" == 1 ]] || die "${table} missing in ClickHouse — deploy ch:up first"
}

match_select() {
	local lo=$1 hi=$2
	cat <<SQL
SELECT
	toUInt64(match_id),
	toDateTime64(captured_at, 3, 'UTC'),
	toUInt32(league_id),
	toFloat32(duration),
	toUInt16(radiant_score),
	toUInt16(dire_score),
	toUInt32(spectators),
	toUInt32(tower_state_radiant),
	toUInt32(tower_state_dire),
	toUInt32(barracks_state_radiant),
	toUInt32(barracks_state_dire),
	toUInt16(roshan_respawn_timer),
	toUInt8(series_type),
	toUInt8(radiant_series_wins),
	toUInt8(dire_series_wins),
	toUInt16(stream_delay_s),
	toString(source),
	toUInt64(lobby_id),
	toUInt8(game_number),
	toUInt32(league_series_id),
	toUInt32(league_game_id),
	toUInt8(league_tier),
	toUInt8(game_state),
	toUInt64(server_steam_id),
	toUInt64(id)
FROM postgresql('${PG_CH_HOST}:5432', '${PG_DB}', 'live_match_ticks', '${PG_USER}', '${PG_PASSWORD}')
WHERE id >= ${lo} AND id < ${hi}
SQL
}

player_select() {
	local lo=$1 hi=$2
	cat <<SQL
SELECT
	toUInt64(match_id),
	toDateTime64(captured_at, 3, 'UTC'),
	toUInt8(player_slot),
	toUInt64(account_id),
	toInt32(hero_id),
	toUInt16(kills),
	toUInt16(deaths),
	toUInt16(assists),
	toUInt32(last_hits),
	toUInt16(denies),
	toUInt32(gold),
	toUInt32(net_worth),
	toUInt8(level),
	toUInt16(gold_per_min),
	toUInt16(xp_per_min),
	toFloat32(x),
	toFloat32(y),
	toString(source),
	toUInt32(item0),
	toUInt32(item1),
	toUInt32(item2),
	toUInt32(item3),
	toUInt32(item4),
	toUInt32(item5),
	toUInt32(item6),
	toUInt32(item7),
	toUInt32(item8),
	toUInt8(ultimate_state),
	toUInt16(ultimate_cooldown),
	toUInt16(respawn_timer),
	toUInt64(id)
FROM postgresql('${PG_CH_HOST}:5432', '${PG_DB}', 'live_player_ticks', '${PG_USER}', '${PG_PASSWORD}')
WHERE id >= ${lo} AND id < ${hi}
SQL
}

migrate_range() {
	local table=$1 lo=$2 hi=$3
	local started pg_count ch_count action elapsed
	started=$(date +%s)
	pg_count=$(pg_query "SELECT count(*) FROM ${table} WHERE id >= ${lo} AND id < ${hi}")
	ch_count=$(ch_query "SELECT count() FROM ${table} WHERE id >= ${lo} AND id < ${hi}")

	if [[ "${pg_count}" -le 0 ]]; then
		action=skip
	elif [[ "${ch_count}" -gt 0 ]]; then
		action=delete_only
		pg_query "DELETE FROM ${table} WHERE id >= ${lo} AND id < ${hi}" >/dev/null
	else
		action=insert_then_delete
		if [[ "${table}" == live_match_ticks ]]; then
			ch_query "INSERT INTO live_match_ticks $(match_select "${lo}" "${hi}")"
		else
			ch_query "INSERT INTO live_player_ticks $(player_select "${lo}" "${hi}")"
		fi
		pg_query "DELETE FROM ${table} WHERE id >= ${lo} AND id < ${hi}" >/dev/null
	fi

	elapsed=$(( $(date +%s) - started ))
	log "\"table\":\"${table}\",\"lo\":${lo},\"hi\":${hi},\"pg\":${pg_count},\"ch\":${ch_count},\"action\":\"${action}\",\"elapsed_s\":${elapsed}"
}

export -f ch_query pg_query log match_select player_select migrate_range
export CH_CONTAINER PG_CONTAINER CH_USER CH_PASSWORD CH_DATABASE
export PG_USER PG_PASSWORD PG_DB PG_CH_HOST

migrate_table() {
	local table=$1
	local min_id max_id count lo hi
	preflight "${table}"
	IFS=$'\t' read -r min_id max_id count <<<"$(pg_query "SELECT COALESCE(min(id),0), COALESCE(max(id),0), count(*) FROM ${table}")"

	log "\"table\":\"${table}\",\"msg\":\"start\",\"min_id\":${min_id},\"max_id\":${max_id},\"pg_count\":${count},\"batch\":${BATCH},\"workers\":${WORKERS}"
	if [[ "${count}" -le 0 ]]; then
		log "\"table\":\"${table}\",\"msg\":\"empty\""
		return
	fi

	lo=${min_id}
	while [[ "${lo}" -le "${max_id}" ]]; do
		while [[ "$(jobs -pr | wc -l | tr -d ' ')" -ge "${WORKERS}" ]]; do
			wait -n
		done
		hi=$((lo + BATCH))
		migrate_range "${table}" "${lo}" "${hi}" &
		lo=${hi}
	done
	wait
	pg_query "VACUUM ANALYZE ${table}"
	log "\"table\":\"${table}\",\"msg\":\"done\",\"pg_left\":$(pg_query "SELECT count(*) FROM ${table}")"
}

preflight live_match_ticks
preflight live_player_ticks
log "\"msg\":\"migrate live ticks\",\"batch\":${BATCH},\"workers\":${WORKERS}"
migrate_table live_player_ticks
migrate_table live_match_ticks
log "\"msg\":\"all done\""
