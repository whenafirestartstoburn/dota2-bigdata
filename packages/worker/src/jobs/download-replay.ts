import {
	objectExists,
	objectStore,
	replayObjectKey,
} from '@app/shared/src/components/s3'
import {
	enqueueDownloadReplay,
	matchOrigin,
} from '@app/shared/src/jobs/fetch-match-details'
import { asNumber, asString } from '@app/shared/src/store/coerce'
import { getMatch } from '@app/shared/src/store/matches'
import {
	ensureReplayRow,
	getReplay,
	markMatchReplayPhase,
	replayBackoffMs,
	updateReplay,
} from '@app/shared/src/store/replays'
import env from '@app/shared/src/utils/env'
import { logger } from '@app/shared/src/utils/logger'

export async function runDownloadReplay(matchId: number): Promise<{
	status: string
	key?: string
}> {
	const match = await getMatch(matchId)
	const origin = matchOrigin(match?.source)
	await ensureReplayRow(matchId, origin)
	const existing = await getReplay(matchId)
	if (existing?.status === 'stored' && typeof existing.s3_key === 'string') {
		if (await objectExists(existing.s3_key)) {
			return { status: 'stored', key: existing.s3_key }
		}
	}

	const url = asString(existing?.source_url)
	if (url == null) {
		throw new Error(
			`replay url missing for match ${matchId} — fetch_match_details must run first`,
		)
	}

	const cluster = asNumber(existing?.cluster) ?? 0
	const salt = asNumber(existing?.replay_salt) ?? 0
	const key = replayObjectKey(matchId, cluster, salt)

	if (await objectExists(key)) {
		await updateReplay(matchId, {
			status: 'stored',
			s3Bucket: env.S3_BUCKET,
			s3Key: key,
			storedAt: new Date(),
		})
		await markMatchReplayPhase(matchId, 'replay_stored')
		return { status: 'stored', key }
	}

	await updateReplay(matchId, { status: 'downloading', sourceUrl: url })
	const response = await fetch(url, {
		signal: AbortSignal.timeout(10 * 60_000),
	})
	if (response.status === 404) {
		const attempts = asNumber(existing?.attempts) ?? 0
		const delay = replayBackoffMs(attempts)
		const next = new Date(Date.now() + delay)
		await updateReplay(matchId, {
			status: 'pending',
			error: `replay not yet published: ${url}`,
			nextAttemptAt: next,
			bumpAttempt: true,
		})
		await enqueueDownloadReplay(matchId, origin, next, {
			jobKeyMode: 'replace',
			ignoreLimit: true,
		})
		logger.info({ matchId, delay }, 'replay 404, rescheduled')
		return { status: 'pending' }
	}
	if (!response.ok || response.body === null) {
		const message = `replay HTTP ${response.status} for ${url}`
		await updateReplay(matchId, { status: 'failed', error: message })
		throw new Error(message)
	}

	const s3 = objectStore()
	await s3.write(key, response, { type: 'application/x-bzip2' })
	const stat = await s3.stat(key)
	await updateReplay(matchId, {
		status: 'stored',
		sourceUrl: url,
		s3Bucket: env.S3_BUCKET,
		s3Key: key,
		bytes: stat.size,
		storedAt: new Date(),
		error: null,
	})
	await markMatchReplayPhase(matchId, 'replay_stored')
	logger.info({ matchId, key, bytes: stat.size }, 'stored replay')
	return { status: 'stored', key }
}
