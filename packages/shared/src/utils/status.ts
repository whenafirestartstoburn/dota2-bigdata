import { AsyncLocalStorage } from 'node:async_hooks'
import { logger } from '#src/utils/logger'

export type StatusFn = (line: string) => void

const store = new AsyncLocalStorage<StatusFn>()

export function withStatus<T>(
	onStatus: StatusFn | undefined,
	run: () => Promise<T>,
): Promise<T> {
	const emit: StatusFn =
		onStatus ??
		((line) => {
			logger.info(line)
		})
	return store.run(emit, run)
}

/** Narrative step for CLI stderr or pino. Never pass secrets. */
export function status(line: string): void {
	const emit = store.getStore()
	if (emit !== undefined) {
		emit(line)
		return
	}
	logger.info(line)
}
