import { logger } from '@app/shared/src/utils/logger'
import { Logger } from 'graphile-worker'

function fieldsFromMessage(message: string): {
	job?: string
	job_id?: string
	trace_id?: string
} {
	const match = /(?:Failed|Completed) task (\S+) \(([^,)]+)/.exec(message)
	if (match == null) return {}
	const jobId = match[1]
	const job = match[2]
	if (jobId == null || job == null) return {}
	return { job, job_id: jobId, trace_id: jobId }
}

export const graphileLogger = new Logger((scope) => {
	return (level, message) => {
		const fromMsg = fieldsFromMessage(message)
		const child = logger.child({
			component: 'graphile',
			...(scope.taskIdentifier != null ? { job: scope.taskIdentifier } : {}),
			...(scope.jobId != null
				? { job_id: scope.jobId, trace_id: scope.jobId }
				: fromMsg),
		})
		if (level === 'error') {
			child.error(message)
			return
		}
		if (level === 'warning') {
			child.warn(message)
			return
		}
		if (level === 'debug') {
			child.debug(message)
			return
		}
		child.info(message)
	}
})
