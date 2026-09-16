import {
	objectBucket,
	objectStore,
	replayObjectKey,
} from '@app/shared/src/components/s3'
import { adoptExistingReplayObject } from '@app/shared/src/jobs/adopt-replay-object'
import {
	enqueueDownloadReplay,
	matchOrigin,
} from '@app/shared/src/jobs/fetch-match-details'
import { observeReplayDownload } from '@app/shared/src/metrics/observe'
import { unpublishedReplayCdnReason } from '@app/shared/src/steam/web-api'
import { asNumber, asString, errorMessage } from '@app/shared/src/store/coerce'
import { ERROR_KIND } from '@app/shared/src/store/match-phase'
import { getMatch } from '@app/shared/src/store/matches'
import {
	ensureReplayRow,
	getReplay,
	markMatchReplayStatus,
	replayBackoffMs,
	updateReplay,
} from '@app/shared/src/store/replays'
import {
	beginRequest,
	bytesToKb,
	finishRequest,
	requestLogStatusFromError,
	truncateErrorResponse,
} from '@app/shared/src/store/request-logs'
import { logger } from '@app/shared/src/utils/logger'

export async function runDownloadReplay(matchId: number): Promise<{
	status: string
	key?: string
}> {
	const started = performance.now()
	try {
		return await downloadReplay(matchId, started)
	} catch (error) {
		observeReplayDownload('error', started)
		throw error
	}
}

async function downloadReplay(
	matchId: number,
	started: number,
): Promise<{
	status: string
	key?: string
}> {
	const match = await getMatch(matchId)
	const origin = matchOrigin(match?.source)
	await ensureReplayRow(matchId, origin)
	const existing = await getReplay(matchId)
	const cluster = asNumber(existing?.cluster) ?? 0
	const salt = asNumber(existing?.replay_salt)
	const adopted = await adoptExistingReplayObject(matchId, existing)
	if (adopted != null) {
		observeReplayDownload('already_stored', started)
		return {
			status: adopted.kept
				? (asString(existing?.status) ?? 'stored')
				: 'stored',
			key: adopted.hit.key,
		}
	}

	const url = asString(existing?.source_url)
	if (url == null) {
		throw new Error(
			`replay url missing for match ${matchId} — fetch_match_details must run first`,
		)
	}

	const unpublished = unpublishedReplayCdnReason(cluster, url)
	if (unpublished != null) {
		await updateReplay(matchId, {
			status: 'unavailable',
			error: unpublished,
			nextAttemptAt: null,
		})
		await markMatchReplayStatus(matchId, 'replay_unavailable', {
			error: unpublished,
			errorKind: ERROR_KIND.unavailable,
		})
		logger.info({ matchId, cluster, url }, 'replay CDN host unpublished')
		observeReplayDownload('not_found', started)
		return { status: 'unavailable' }
	}

	const key = replayObjectKey(matchId, cluster, salt ?? 0)

	await updateReplay(matchId, { status: 'downloading', sourceUrl: url })
	const logRow = await beginRequest('replay_requests', {
		matchId,
		methodName: 'GetReplay',
	})
	const fetchStarted = performance.now()
	let response: Response
	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(10 * 60_000),
		})
	} catch (error) {
		await finishRequest(logRow, {
			responseTimeMs: performance.now() - fetchStarted,
			responseStatus: requestLogStatusFromError(error),
			errorResponse: truncateErrorResponse(errorMessage(error)),
		})
		throw error
	}
	if (response.status === 404) {
		const errBody = await response.text().catch(() => '')
		await finishRequest(logRow, {
			responseTimeMs: performance.now() - fetchStarted,
			responseStatus: '404',
			responseSizeKb: bytesToKb(Buffer.byteLength(errBody)),
			errorResponse: truncateErrorResponse(
				errBody !== '' ? errBody : `replay not yet published: ${url}`,
			),
		})
		const attempts = asNumber(existing?.attempts) ?? 0
		const delay = replayBackoffMs(attempts)
		if (delay == null) {
			const message = `replay 404 exhausted after ${attempts + 1} tries: ${url}`
			await updateReplay(matchId, {
				status: 'unavailable',
				error: message,
				nextAttemptAt: null,
				bumpAttempt: true,
			})
			await markMatchReplayStatus(matchId, 'replay_unavailable', {
				error: message,
				errorKind: ERROR_KIND.unavailable,
			})
			logger.info({ matchId, attempts: attempts + 1 }, 'replay 404 exhausted')
			observeReplayDownload('not_found', started)
			return { status: 'unavailable' }
		}
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
		observeReplayDownload('not_found', started)
		return { status: 'pending' }
	}
	if (!response.ok || response.body === null) {
		const errBody = await response.text().catch(() => '')
		const message = `replay HTTP ${response.status} for ${url}`
		await finishRequest(logRow, {
			responseTimeMs: performance.now() - fetchStarted,
			responseStatus: String(response.status),
			responseSizeKb: bytesToKb(Buffer.byteLength(errBody)),
			errorResponse: truncateErrorResponse(errBody !== '' ? errBody : message),
		})
		await updateReplay(matchId, { status: 'failed', error: message })
		throw new Error(message)
	}

	const s3 = objectStore()
	try {
		await s3.write(key, response, { type: 'application/x-bzip2' })
		const stat = await s3.stat(key)
		await finishRequest(logRow, {
			responseTimeMs: performance.now() - fetchStarted,
			responseStatus: String(response.status),
			responseSizeKb: bytesToKb(stat.size),
		})
		await updateReplay(matchId, {
			status: 'stored',
			sourceUrl: url,
			s3Bucket: objectBucket(),
			s3Key: key,
			bytes: stat.size,
			storedAt: new Date(),
			error: null,
			clearArchived: true,
		})
		await markMatchReplayStatus(matchId, 'replay_stored')
		logger.info({ matchId, key, bytes: stat.size }, 'stored replay')
		observeReplayDownload('success', started, stat.size)
		return { status: 'stored', key }
	} catch (error) {
		await finishRequest(logRow, {
			responseTimeMs: performance.now() - fetchStarted,
			responseStatus: String(response.status),
			errorResponse: truncateErrorResponse(errorMessage(error)),
		})
		throw error
	}
}
