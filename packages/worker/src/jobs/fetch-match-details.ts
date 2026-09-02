import { REPLAY_STATE } from '@app/shared/src/gc/protobuf'
import {
	enqueueDownloadReplay,
	enqueueFetchMatchDetails,
	matchOrigin,
} from '@app/shared/src/jobs/fetch-match-details'
import { replayUrl } from '@app/shared/src/steam/web-api'
import { asNumber, asString, errorMessage } from '@app/shared/src/store/coerce'
import { getMatch } from '@app/shared/src/store/matches'
import { persistMatchRecord } from '@app/shared/src/store/persist-match'
import {
	copyReplayLocatorFromMatch,
	ensureReplayRow,
	getReplay,
	updateReplay,
} from '@app/shared/src/store/replays'
import { db } from '@app/shared/src/utils/db'
import { logger } from '@app/shared/src/utils/logger'
import { isNoUsableGcAccount, requestMatchReplayLocator } from '#src/gc/session'

export async function runFetchMatchDetails(input: {
	matchId: number
	origin?: 'live' | 'historical'
}): Promise<{ saved: number; url?: string }> {
	const match = await getMatch(input.matchId)
	const origin = input.origin ?? matchOrigin(match?.source)
	await ensureReplayRow(input.matchId, origin)
	await copyReplayLocatorFromMatch(input.matchId)
	const replay = await getReplay(input.matchId)
	let cluster = asNumber(replay?.cluster) ?? asNumber(match?.cluster)
	let salt = asNumber(replay?.replay_salt) ?? asNumber(match?.replay_salt)
	const existingUrl = asString(replay?.source_url)

	if (cluster != null && salt != null && existingUrl != null) {
		await enqueueDownloadReplay(input.matchId, origin)
		return { saved: 0, url: existingUrl }
	}

	let locator: Awaited<ReturnType<typeof requestMatchReplayLocator>>
	try {
		locator = await requestMatchReplayLocator(input.matchId)
	} catch (error) {
		if (!isNoUsableGcAccount(error)) throw error
		const message = errorMessage(error)
		await updateReplay(input.matchId, { status: 'failed', error: message })
		logger.warn(
			{ matchId: input.matchId, reason: message },
			'GC details failed',
		)
		return { saved: 0 }
	}

	if (locator.result !== 1 && locator.result !== 0) {
		throw new Error(`GC result ${locator.result} for match ${input.matchId}`)
	}
	if (
		locator.replayState === REPLAY_STATE.notRecorded ||
		locator.replayState === REPLAY_STATE.expired
	) {
		await updateReplay(input.matchId, {
			status: 'unavailable',
			replayState: locator.replayState,
			cluster: locator.cluster,
			replaySalt: locator.replaySalt,
			steamAccountId: locator.accountId,
			proxyId: locator.proxyId,
			error: `replay_state=${locator.replayState}`,
		})
		return { saved: 0 }
	}

	const gcMatch = locator.match
	if (gcMatch != null && gcMatch.match_id != null) {
		await db.transaction(async (tx) => {
			await persistMatchRecord(tx, gcMatch, {
				mustExist: false,
				skipStoryObjectives: true,
			})
		})
	}

	cluster = locator.cluster ?? cluster
	salt = locator.replaySalt ?? salt
	if (cluster == null || salt == null) {
		await enqueueFetchMatchDetails(
			input.matchId,
			origin,
			new Date(Date.now() + 60_000),
		)
		logger.info(
			{ matchId: input.matchId },
			'GC details had no cluster/salt, retry',
		)
		return { saved: gcMatch != null ? 1 : 0 }
	}

	const url = replayUrl(cluster, input.matchId, salt)
	await updateReplay(input.matchId, {
		cluster,
		replaySalt: salt,
		replayState: locator.replayState,
		sourceUrl: url,
		steamAccountId: locator.accountId,
		proxyId: locator.proxyId,
	})
	await enqueueDownloadReplay(input.matchId, origin)
	logger.info({ matchId: input.matchId, url }, 'GC match details + replay url')
	return { saved: 1, url }
}
