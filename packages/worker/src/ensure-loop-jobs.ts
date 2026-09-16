import { asString, errorMessage } from '@app/shared/src/store/coerce'
import { db, sql, sqlIn } from '@app/shared/src/utils/db'
import { logger } from '@app/shared/src/utils/logger'
import type { StartupJob } from '#src/roles'

export type EnqueueLoopJob = (
	identifier: string,
	payload: Record<string, never>,
	spec: {
		jobKey: string
		jobKeyMode: 'replace'
		priority?: number
		maxAttempts?: number
	},
) => Promise<unknown>

export type ListenEvents = {
	on(event: 'pool:listen:error', listener: () => void): void
	on(event: 'pool:listen:success', listener: () => void): void
}

export function loopJobsToRequeue(
	jobs: readonly StartupJob[],
	aliveKeys: ReadonlySet<string>,
): StartupJob[] {
	return jobs.filter((job) => job.jobKey != null && !aliveKeys.has(job.jobKey))
}

export async function loadAliveLoopKeys(
	keys: readonly string[],
): Promise<Set<string>> {
	const alive = new Set<string>()
	if (keys.length === 0) return alive
	const rows = await db.execute(sql`
		SELECT key
		FROM graphile_worker.jobs
		WHERE key IN ${sqlIn(keys)}
			AND (locked_at IS NOT NULL OR attempts < max_attempts)
	`)
	for (const row of rows) {
		const key = asString(row.key)
		if (key != null) alive.add(key)
	}
	return alive
}

export async function runEnsureLoopJobs(
	addJob: EnqueueLoopJob,
	jobs: readonly StartupJob[],
): Promise<void> {
	const keys = jobs.flatMap((job) => (job.jobKey != null ? [job.jobKey] : []))
	const missing = loopJobsToRequeue(jobs, await loadAliveLoopKeys(keys))
	for (const job of missing) {
		const jobKey = job.jobKey
		if (jobKey == null) continue
		await addJob(
			job.identifier,
			{},
			{
				jobKey,
				jobKeyMode: 'replace',
				priority: job.priority,
				maxAttempts: job.maxAttempts,
			},
		)
		logger.warn({ job: job.identifier, jobKey }, 'loop job recovered')
	}
}

export function attachLoopJobRecovery(
	events: ListenEvents,
	recover: () => Promise<void>,
): void {
	let recoverOnListen = false
	events.on('pool:listen:error', () => {
		recoverOnListen = true
	})
	events.on('pool:listen:success', () => {
		if (!recoverOnListen) return
		void recover()
			.then(() => {
				recoverOnListen = false
			})
			.catch((error: unknown) => {
				logger.error(
					{ err: errorMessage(error) },
					'loop job recovery after listen failed',
				)
			})
	})
}
