export type LeagueStatus = 'UPCOMING' | 'LIVE' | 'FINISHED'

export type LeagueTimestamps = {
	league_id: number
	start_timestamp: number
	end_timestamp: number
	most_recent_activity: number
	valve_status: number
}

const STALE_ACTIVITY_SEC = 14 * 24 * 60 * 60

// Valve's own `status` on GetLeagueInfoList is a publication flag
// (5 ≈ concluded), not "the tournament is being played right now".
// Our UPCOMING | LIVE | FINISHED is derived so a SQL query can answer
// "what can we collect today" without re-reading timestamps.
export function deriveLeagueStatus(
	league: LeagueTimestamps,
	nowSec: number,
	liveLeagueIds: ReadonlySet<number>,
): LeagueStatus {
	if (liveLeagueIds.has(league.league_id)) return 'LIVE'

	if (league.start_timestamp > 0 && nowSec < league.start_timestamp) {
		return 'UPCOMING'
	}

	if (league.end_timestamp > 0 && nowSec > league.end_timestamp) {
		return 'FINISHED'
	}

	if (league.valve_status === 5) return 'FINISHED'

	if (
		league.most_recent_activity > 0 &&
		nowSec - league.most_recent_activity > STALE_ACTIVITY_SEC
	) {
		return 'FINISHED'
	}

	if (
		league.start_timestamp > 0 &&
		nowSec >= league.start_timestamp &&
		(league.end_timestamp === 0 || nowSec <= league.end_timestamp)
	) {
		return 'LIVE'
	}

	return 'LIVE'
}
