import {
	enqueueDownloadReplay,
	enqueueFetchMatchDetails,
} from '@app/shared/src/jobs/fetch-match-details'
import { asNumber } from '@app/shared/src/store/coerce'
import { db, sql } from '@app/shared/src/utils/db'

const details = await db.execute(sql`
	SELECT match_id
	FROM matches
	WHERE source = 'live'
		AND phase = 'awaiting_details'
`)
for (const row of details) {
	const matchId = asNumber(row.match_id)
	if (matchId == null) continue
	await enqueueFetchMatchDetails(matchId, 'live')
	console.log('details', matchId)
}

await db.execute(sql`
	UPDATE matches
	SET replay_available_at = now(), updated_at = now()
	WHERE source = 'live'
		AND phase IN ('details_ready', 'awaiting_replay')
`)

const downloads = await db.execute(sql`
	SELECT r.match_id
	FROM match_replays r
	JOIN matches m ON m.match_id = r.match_id
	WHERE m.source = 'live'
		AND m.phase IN ('details_ready', 'awaiting_replay')
		AND r.source_url IS NOT NULL
		AND r.status IN ('pending', 'downloading')
`)
for (const row of downloads) {
	const matchId = asNumber(row.match_id)
	if (matchId == null) continue
	await enqueueDownloadReplay(matchId, 'live', new Date(), {
		jobKeyMode: 'replace',
		ignoreLimit: true,
	})
	console.log('download', matchId)
}

await db.$client.end({ timeout: 5 })
