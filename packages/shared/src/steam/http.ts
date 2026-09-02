import { AsyncLocalStorage } from 'node:async_hooks'

const proxyStore = new AsyncLocalStorage<string>()

/** Chrome 151, same as a successful /dev/requestkey from a real browser. */
export const STEAM_CHROME_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

/** Official iOS Steam app (3.10.9), same as /mobileconf/ajaxop. */
export const STEAM_MOBILE_UA =
	'Steam Mobile/10472498 CFNetwork/3860.100.1 Darwin/25.0.0'

export class MissingProxyError extends Error {
	constructor(message = 'Steam HTTP calls require a proxy') {
		super(message)
		this.name = 'MissingProxyError'
	}
}

export function runWithProxy<T>(
	proxyUrl: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (proxyUrl === '') throw new MissingProxyError()
	return proxyStore.run(proxyUrl, fn)
}

export function activeProxyUrl(explicit?: string | null): string {
	const proxy =
		explicit != null && explicit !== '' ? explicit : proxyStore.getStore()
	if (proxy == null || proxy === '') throw new MissingProxyError()
	return proxy
}

export async function steamFetch(
	input: string | URL | Request,
	init?: RequestInit & { proxy?: string | null },
): Promise<Response> {
	const proxy = activeProxyUrl(init?.proxy)
	return fetch(input, { ...init, proxy })
}

export function unwrapSteamResponse(body: unknown): Record<string, unknown> {
	if (typeof body !== 'object' || body === null) return {}
	const root = body as Record<string, unknown>
	const inner = root.response
	if (typeof inner === 'object' && inner !== null) {
		return inner as Record<string, unknown>
	}
	return root
}
