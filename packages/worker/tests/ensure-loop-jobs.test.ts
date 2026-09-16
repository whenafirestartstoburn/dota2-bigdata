import { describe, expect, test } from 'bun:test'
import { attachLoopJobRecovery, loopJobsToRequeue } from '#src/ensure-loop-jobs'
import type { StartupJob } from '#src/roles'

const jobs: StartupJob[] = [
	{ identifier: 'poll_live_games', jobKey: 'poll_live_games', loop: true },
	{ identifier: 'poll_top_live', jobKey: 'poll_top_live', loop: true },
	{ identifier: 'fetch_leagues', jobKey: 'fetch_leagues_startup' },
]

describe('loopJobsToRequeue', () => {
	test('skips keys that are scheduled or locked', () => {
		expect(
			loopJobsToRequeue(jobs, new Set(['poll_live_games'])).map(
				(job) => job.identifier,
			),
		).toEqual(['poll_top_live', 'fetch_leagues'])
	})

	test('revives a permafailed key the same as a missing one', () => {
		expect(loopJobsToRequeue(jobs, new Set()).map((job) => job.jobKey)).toEqual(
			['poll_live_games', 'poll_top_live', 'fetch_leagues_startup'],
		)
	})
})

describe('attachLoopJobRecovery', () => {
	test('reseeds only after a listen error, then a successful listen', async () => {
		const listeners = new Map<string, Array<() => void>>()
		const events = {
			on(
				event: 'pool:listen:error' | 'pool:listen:success',
				listener: () => void,
			) {
				const list = listeners.get(event) ?? []
				list.push(listener)
				listeners.set(event, list)
			},
		}
		const emit = (event: string) => {
			for (const listener of listeners.get(event) ?? []) listener()
		}

		let calls = 0
		attachLoopJobRecovery(events, async () => {
			calls += 1
		})

		emit('pool:listen:success')
		expect(calls).toBe(0)

		emit('pool:listen:error')
		emit('pool:listen:success')
		await Bun.sleep(0)
		expect(calls).toBe(1)

		emit('pool:listen:success')
		await Bun.sleep(0)
		expect(calls).toBe(1)
	})
})
