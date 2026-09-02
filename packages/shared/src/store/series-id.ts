import { createHash } from 'node:crypto'

const SYNTHETIC_FLAG = 1n << 48n

export function syntheticSeriesId(input: {
	leagueId: number
	teamA: number
	teamB: number
	firstMatchId: number
}): number {
	const low = Math.min(input.teamA, input.teamB)
	const high = Math.max(input.teamA, input.teamB)
	const n = createHash('sha256')
		.update(`${input.leagueId}:${low}:${high}:${input.firstMatchId}`)
		.digest()
		.readUInt32BE(0)
	return Number(SYNTHETIC_FLAG | BigInt(n))
}
