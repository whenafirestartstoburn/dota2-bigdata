import {
	deleteReplayRows,
	insertJsonEachRow,
} from '@app/shared/src/components/clickhouse'
import { objectStore } from '@app/shared/src/components/s3'
import { chDateTime } from '@app/shared/src/jobs/time'
import {
	decompressReplayFile,
	parseDemToNdjson,
} from '@app/shared/src/steam/dem/parse'
import { ingestReplayNdjson } from '@app/shared/src/steam/ingest-replay'
import {
	PARSER_SCHEMA_VERSION,
	toValvePlayerSlot,
} from '@app/shared/src/steam/parser-events'
import { asNumber } from '@app/shared/src/store/coerce'
import {
	getMatch,
	replaceMatchDraft,
	replaceObjectives,
} from '@app/shared/src/store/matches'
import { getReplay, updateReplay } from '@app/shared/src/store/replays'
import { db, sql } from '@app/shared/src/utils/db'
import { logger } from '@app/shared/src/utils/logger'

const BATCH = 2_000

export async function runParseReplay(matchId: number): Promise<{
	events: number
}> {
	const replay = await getReplay(matchId)
	const key = replay?.s3_key
	if (typeof key !== 'string' || key === '') {
		throw new Error(`no s3 object for match ${matchId}`)
	}
	const match = await getMatch(matchId)
	const startTime = chDateTime(asNumber(match?.start_time))

	await updateReplay(matchId, { status: 'parsing' })
	const compressed = new Uint8Array(await objectStore().file(key).arrayBuffer())
	const dem = await decompressReplayFile(compressed)
	const ndjson = parseDemToNdjson(dem)

	await deleteReplayRows(matchId)

	const { events, buckets, objectives, draft, lastInterval } =
		ingestReplayNdjson(matchId, startTime, ndjson)

	for (const [table, rows] of buckets) {
		while (rows.length > 0) {
			const chunk = rows.splice(0, BATCH)
			await insertJsonEachRow(table, chunk)
		}
	}

	if (objectives.length > 0) {
		await replaceObjectives(db, matchId, objectives)
	}
	if (draft.length > 0) {
		await replaceMatchDraft(db, matchId, draft)
	}
	for (const [slot, row] of lastInterval) {
		await db.execute(sql`
			UPDATE match_players SET
				hero_variant = COALESCE(${asNumber(row.variant)}, hero_variant),
				selected_facet = COALESCE(${asNumber(row.variant)}, selected_facet),
				hero_was_randomed = COALESCE(
					${asNumber(row.randomed) === 1 ? true : null},
					hero_was_randomed
				),
				stuns = COALESCE(${asNumber(row.stuns)}, stuns),
				teamfight_participation = COALESCE(
					${asNumber(row.teamfight_participation)},
					teamfight_participation
				),
				towers_killed = COALESCE(${asNumber(row.towers_killed)}, towers_killed),
				roshans_killed = COALESCE(${asNumber(row.roshans_killed)}, roshans_killed),
				observers_placed = COALESCE(${asNumber(row.obs_placed)}, observers_placed),
				sentries_placed = COALESCE(${asNumber(row.sen_placed)}, sentries_placed),
				camps_stacked = COALESCE(${asNumber(row.camps_stacked)}, camps_stacked),
				creeps_stacked = COALESCE(${asNumber(row.creeps_stacked)}, creeps_stacked),
				rune_pickups = COALESCE(${asNumber(row.rune_pickups)}, rune_pickups),
				firstblood_claimed = COALESCE(
					${asNumber(row.firstblood_claimed)},
					firstblood_claimed
				),
				updated_at = now()
			WHERE match_id = ${matchId} AND player_slot = ${toValvePlayerSlot(slot)}
		`)
	}

	await updateReplay(matchId, {
		status: 'parsed',
		parserVersion: PARSER_SCHEMA_VERSION,
		parsedAt: new Date(),
		error: null,
	})
	logger.info({ matchId, events }, 'parsed replay')
	return { events }
}
