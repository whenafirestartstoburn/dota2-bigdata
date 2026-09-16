import { parseArgs } from 'node:util'
import {
	pickApiCredential,
	steamCtx,
} from '@app/shared/src/components/resources'
import { getMatchHistoryBySequenceNum } from '@app/shared/src/steam/web-api'
import { asNumber } from '@app/shared/src/store/coerce'
import { markSeqFetched } from '@app/shared/src/store/matches'
import { persistMatchRecord } from '@app/shared/src/store/persist-match'
import { db, sql } from '@app/shared/src/utils/db'

const { values } = parseArgs({
	options: {
		league: { type: 'string' },
		limit: { type: 'string', default: '0' },
	},
})

const leagueId = Number(values.league)
if (!Number.isFinite(leagueId) || leagueId <= 0) {
	console.error('usage: ingest-league-details --league 13256 [--limit N]')
	process.exit(1)
}
const limit = Number(values.limit) || 0

const pending =
	limit > 0
		? await db.execute(sql`
			SELECT match_id, match_seq_num
			FROM matches
			WHERE league_id = ${leagueId}
				AND match_seq_num IS NOT NULL
				AND duration IS NULL
			ORDER BY match_seq_num
			LIMIT ${limit}
		`)
		: await db.execute(sql`
			SELECT match_id, match_seq_num
			FROM matches
			WHERE league_id = ${leagueId}
				AND match_seq_num IS NOT NULL
				AND duration IS NULL
			ORDER BY match_seq_num
		`)

const targets = new Map<number, number>()
for (const row of pending) {
	const matchId = asNumber(row.match_id)
	const seq = asNumber(row.match_seq_num)
	if (matchId == null || seq == null || seq <= 0) continue
	targets.set(matchId, seq)
}

console.log(
	JSON.stringify({ leagueId, pending: targets.size, limit: limit || null }),
)

let saved = 0
let calls = 0
const remaining = new Set(targets.keys())
const seqs = [...new Set(targets.values())].sort((a, b) => a - b)

for (const startSeq of seqs) {
	if (remaining.size === 0) break
	const stillNeeded = [...remaining].some((id) => {
		const seq = targets.get(id)
		return seq != null && seq >= startSeq
	})
	if (!stillNeeded) continue

	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'historical')
	const window = await getMatchHistoryBySequenceNum(ctx, {
		startAtMatchSeqNum: startSeq,
		matchesRequested: 25,
	})
	calls += 1
	for (const match of window.matches) {
		if (!remaining.has(match.match_id)) continue
		await db.transaction(async (tx) => {
			await persistMatchRecord(tx, match, {
				mustExist: true,
				fetched: 'seq',
			})
			await markSeqFetched(tx, [match.match_id])
		})
		remaining.delete(match.match_id)
		saved += 1
		console.log(
			JSON.stringify({
				saved: match.match_id,
				seq: match.match_seq_num,
				left: remaining.size,
			}),
		)
	}
}

console.log(
	JSON.stringify({ done: true, calls, saved, missing: remaining.size }),
)
