import { runMaintainRequestLogs } from '#src/store/request-logs'

export async function runMaintainRequestLogsJob(): Promise<void> {
	await runMaintainRequestLogs()
}
