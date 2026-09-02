import {
	announcementObjective,
	mapReplayEvent,
	type ObjectiveKind,
} from '#src/steam/parser-events'
import { asNumber } from '#src/store/coerce'

export type IngestedObjective = {
	seq: number
	time: number
	kind: ObjectiveKind
	team: number | null
	slot: number | null
	key: string | null
	value: number | null
}

export type IngestedDraft = {
	ord: number
	isPick: boolean
	heroId: number
	team: number
	playerSlot: number | null
	clock: number | null
}

export type IngestedReplay = {
	events: number
	buckets: Map<string, Array<Record<string, unknown>>>
	objectives: IngestedObjective[]
	draft: IngestedDraft[]
	lastInterval: Map<number, Record<string, unknown>>
}

export function ingestReplayNdjson(
	matchId: number,
	startTime: string,
	ndjson: string,
): IngestedReplay {
	const buckets = new Map<string, Array<Record<string, unknown>>>()
	const lastInterval = new Map<number, Record<string, unknown>>()
	const objectives: IngestedObjective[] = []
	const draft: IngestedDraft[] = []
	let events = 0
	let seq = 0

	for (const line of ndjson.split('\n')) {
		if (line.trim() === '') continue
		let entry: Record<string, unknown>
		try {
			entry = JSON.parse(line) as Record<string, unknown>
		} catch {
			continue
		}
		const mapped = mapReplayEvent(matchId, startTime, entry)
		if (mapped == null) continue
		events += 1
		const bucket = buckets.get(mapped.table) ?? []
		bucket.push(mapped.row)
		buckets.set(mapped.table, bucket)

		if (mapped.table === 'replay_intervals') {
			const slot = asNumber(mapped.row.slot)
			if (slot != null) lastInterval.set(slot, mapped.row)
		}
		if (mapped.table === 'replay_announcements') {
			const kind = announcementObjective(String(mapped.row.kind ?? ''))
			if (kind != null) {
				objectives.push({
					seq,
					time: asNumber(mapped.row.time) ?? 0,
					kind,
					team: null,
					slot: asNumber(mapped.row.slot),
					key: String(mapped.row.kind),
					value: asNumber(mapped.row.value),
				})
				seq += 1
			}
		}
		if (mapped.table === 'replay_draft') {
			draft.push({
				ord: asNumber(mapped.row.ord) ?? draft.length,
				isPick: mapped.row.is_pick === 1,
				heroId: asNumber(mapped.row.hero_id) ?? 0,
				team: asNumber(mapped.row.team) ?? 0,
				playerSlot: asNumber(mapped.row.slot),
				clock: asNumber(mapped.row.clock),
			})
		}
	}

	return { events, buckets, objectives, draft, lastInterval }
}
