import { enqueueDownloadReplay } from '@app/shared/src/jobs/fetch-match-details'
import { asNumber } from '@app/shared/src/store/coerce'
import { db, sql } from '@app/shared/src/utils/db'

await db.execute(sql`
	UPDATE graphile_worker._private_job_queues
	SET locked_at = NULL, locked_by = NULL
	WHERE queue_name IN ('replay-historical', 'replay-live')
		AND locked_at IS NOT NULL
`)

await db.execute(sql`
	UPDATE match_replays
	SET status = 'pending', updated_at = now()
	WHERE status = 'downloading'
`)

const rows = await db.execute(sql`
	SELECT r.match_id
	FROM match_replays r
	JOIN matches m ON m.match_id = r.match_id
	WHERE r.source_url IS NOT NULL
		AND r.status = 'pending'
		AND m.source = 'historical'
		AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
`)

let queued = 0
for (const row of rows) {
	const matchId = asNumber(row.match_id)
	if (matchId == null) continue
	await enqueueDownloadReplay(matchId, 'historical', new Date(), {
		jobKeyMode: 'replace',
		ignoreLimit: true,
	})
	queued += 1
}

const shards = await db.execute(sql`
	SELECT queue_name, count(*)::int AS n
	FROM graphile_worker.jobs
	WHERE task_identifier = 'download_replay'
	GROUP BY 1
	ORDER BY 1
`)
console.log(`requeued ${queued} historical downloads`)
for (const row of shards) {
	console.log(`${row.queue_name}\t${row.n}`)
}

await db.$client.end({ timeout: 5 })
