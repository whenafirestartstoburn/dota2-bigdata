export {
	PublicMatchError,
	SteamApiError,
	type SteamRequestContext,
} from '#src/steam/api/client'
export {
	getLeagueInfoList,
	getLiveLeagueGames,
	getMatchHistoryBySequenceNum,
	getMatchHistoryPage,
	getRealtimeStats,
	getTopLiveGames,
} from '#src/steam/api/methods'

export function replayUrl(
	cluster: number,
	matchId: number,
	salt: number,
): string {
	return `http://replay${cluster}.valve.net/570/${matchId}_${salt}.dem.bz2`
}

/**
 * Valve never published a CDN for cluster 0/1 (`replay1.valve.net`
 * is NXDOMAIN). Fetching those URLs only fills the download retry
 * limiter.
 */
export function unpublishedReplayCdnReason(
	cluster: number,
	url?: string | null,
): string | null {
	if (cluster < 2) {
		return `replay CDN does not exist for cluster ${cluster} (replay${cluster}.valve.net)`
	}
	if (url == null || url === '') return null
	try {
		if (new URL(url).hostname.toLowerCase() === 'replay1.valve.net') {
			return `replay CDN host replay1.valve.net does not exist: ${url}`
		}
	} catch {
		return null
	}
	return null
}
