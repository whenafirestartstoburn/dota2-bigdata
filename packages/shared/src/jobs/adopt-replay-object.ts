import {
	locateReplayObject,
	type ReplayObjectHit,
	replayObjectKey,
} from '#src/components/s3'
import { asNumber, asString } from '#src/store/coerce'
import {
	markMatchReplayStatus,
	replayDownloadShouldKeepStatus,
	updateReplay,
} from '#src/store/replays'

export type ReplayObjectRow = {
	cluster?: unknown
	replay_salt?: unknown
	s3_bucket?: unknown
	s3_key?: unknown
	status?: unknown
}

export type LocateReplayObject = (
	hotKey: string,
	existing?: { bucket?: string | null; key?: string | null },
) => Promise<ReplayObjectHit | null>

export function replayHotKey(
	matchId: number,
	existing?: ReplayObjectRow | null,
): string | null {
	const salt = asNumber(existing?.replay_salt)
	if (salt != null) {
		return replayObjectKey(matchId, asNumber(existing?.cluster) ?? 0, salt)
	}
	return asString(existing?.s3_key)
}

/**
 * If the .dem.bz2 is already on hot or cold storage, point the row at it
 * and skip Valve CDN. Parsed / parsing rows keep their status.
 */
export async function adoptExistingReplayObject(
	matchId: number,
	existing?: ReplayObjectRow | null,
	locate: LocateReplayObject = locateReplayObject,
): Promise<{ hit: ReplayObjectHit; kept: boolean } | null> {
	const hotKey = replayHotKey(matchId, existing)
	if (hotKey == null) return null
	const hit = await locate(hotKey, {
		bucket: asString(existing?.s3_bucket),
		key: asString(existing?.s3_key),
	})
	if (hit == null) return null
	const kept = replayDownloadShouldKeepStatus(asString(existing?.status))
	if (!kept) {
		await updateReplay(matchId, {
			status: 'stored',
			s3Bucket: hit.bucket,
			s3Key: hit.key,
			storedAt: new Date(),
			clearArchived: !hit.archived,
		})
		await markMatchReplayStatus(matchId, 'replay_stored')
	}
	return { hit, kept }
}
