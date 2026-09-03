import { getAppSettings } from '#src/components/settings'
import env from '#src/utils/env'

let nextAllowedAt = 0
let chain: Promise<void> = Promise.resolve()

export async function darkShoppingSlot(): Promise<void> {
	const settings = await getAppSettings()
	const run = chain.then(async () => {
		const wait = nextAllowedAt - Date.now()
		if (wait > 0) await Bun.sleep(wait)
		nextAllowedAt = Date.now() + settings.marketplaceMinIntervalMs
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
