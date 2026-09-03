import env from '#src/utils/env'

const MIN_INTERVAL_MS = 500

let nextAllowedAt = 0
let chain: Promise<void> = Promise.resolve()

export async function darkShoppingSlot(): Promise<void> {
	const run = chain.then(async () => {
		const wait = nextAllowedAt - Date.now()
		if (wait > 0) await Bun.sleep(wait)
		nextAllowedAt = Date.now() + MIN_INTERVAL_MS
	})
	chain = run.then(
		() => undefined,
		() => undefined,
	)
	await run
}

export function darkShoppingConfigured(): boolean {
	return env.DARK_SHOPPING_API_KEY.trim() !== ''
}

export function darkShoppingBaseUrl(): string {
	return env.DARK_SHOPPING_BASE_URL.replace(/\/$/, '')
}
