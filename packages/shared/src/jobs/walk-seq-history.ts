import {
	countJobs,
	enqueueJob,
	jobKeyIsAlive,
	PRIORITY,
} from '#src/components/jobs'
import { getAppSettings } from '#src/components/settings'
import {
	casAdvanceSeqWalkCursor,
	claimAdvance,
	readSeqWalkCooldown,
	readSeqWalkCursor,
	SEQ_WINDOW_JOB,
	seqWindowJobKey,
	WALK_SEQ_JOB,
	WALK_SEQ_JOB_KEY,
} from '#src/jobs/seq-walk-cursor'
import { logger } from '#src/utils/logger'

export { WALK_SEQ_JOB, WALK_SEQ_JOB_KEY }

export async function enqueueFetchSeqWindow(
	startAt: number,
	runAt?: Date,
): Promise<void> {
	await enqueueJob({
		identifier: SEQ_WINDOW_JOB,
		payload: { start_at: startAt },
		priority: PRIORITY.walkHistory,
		runAt,
		jobKey: seqWindowJobKey(startAt),
		jobKeyMode: runAt != null ? 'preserve_run_at' : 'unsafe_dedupe',
		maxAttempts: 25,
	})
}

export async function enqueueSeqWalkWindows(): Promise<{
	enqueued: number
	delayMs: number
}> {
	const settings = await getAppSettings()
	const cooldown = await readSeqWalkCooldown()
	if (cooldown != null && cooldown.getTime() > Date.now()) {
		return {
			enqueued: 0,
			delayMs: Math.max(0, cooldown.getTime() - Date.now()),
		}
	}

	const inflight = await countJobs(SEQ_WINDOW_JOB)
	let room = settings.seqWalkParallelism - inflight
	let enqueued = 0
	let spins = 0
	while (room > 0 && spins < settings.seqWalkParallelism * 4) {
		spins += 1
		const claimed = await claimSeqWalkWindow(settings.seqBatchSize)
		if (claimed == null) break
		if (claimed.alreadyAlive) continue
		enqueued += 1
		room -= 1
	}
	return { enqueued, delayMs: settings.seqWalkIntervalMs }
}

export async function runWalkSeqHistory(): Promise<{
	enqueued: number
	delayMs: number
}> {
	const result = await enqueueSeqWalkWindows()
	logger.info(
		{ enqueued: result.enqueued, delayMs: result.delayMs },
		'seq walk claimed windows',
	)
	return result
}

async function claimSeqWalkWindow(
	batchSize: number,
): Promise<{ startAt: number; alreadyAlive: boolean } | null> {
	const cursor = await readSeqWalkCursor()
	const jobKey = seqWindowJobKey(cursor)
	const next = claimAdvance(cursor, batchSize)
	if (await jobKeyIsAlive(jobKey)) {
		await casAdvanceSeqWalkCursor(cursor, next)
		return { startAt: cursor, alreadyAlive: true }
	}
	await enqueueFetchSeqWindow(cursor)
	await casAdvanceSeqWalkCursor(cursor, next)
	return { startAt: cursor, alreadyAlive: false }
}

export async function scheduleWalkSeqHistory(delayMs: number): Promise<void> {
	await enqueueJob({
		identifier: WALK_SEQ_JOB,
		payload: {},
		priority: PRIORITY.walkHistory,
		jobKey: WALK_SEQ_JOB_KEY,
		jobKeyMode: 'replace',
		maxAttempts: 25,
		runAt: new Date(Date.now() + Math.max(0, delayMs)),
	})
}
