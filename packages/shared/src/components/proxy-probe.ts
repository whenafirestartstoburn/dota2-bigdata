import SteamUser from 'steam-user'
import type { ProxyKind } from '#src/components/proxies'
import { FetchWebApiTransport } from '#src/steam/fetch-transport'
import { errorMessage } from '#src/store/coerce'

export async function probeProxyApi(
	url: string,
): Promise<{ ok: boolean; error: string | null }> {
	try {
		const result = await new FetchWebApiTransport(url).sendRequest({
			apiInterface: 'Authentication',
			apiMethod: 'GetPasswordRSAPublicKey',
			apiVersion: 1,
			requestData: Buffer.from('CgR0ZXN0', 'base64'),
		})
		if (result.result !== 1) {
			return {
				ok: false,
				error: `WebAPI eresult=${String(result.result ?? 'missing')}`,
			}
		}
		if (
			!Buffer.isBuffer(result.responseData) ||
			result.responseData.length === 0
		) {
			return { ok: false, error: 'WebAPI empty response' }
		}
		return { ok: true, error: null }
	} catch (error) {
		return { ok: false, error: errorMessage(error) }
	}
}

export async function probeProxyGc(
	kind: ProxyKind,
	url: string,
): Promise<{ ok: boolean; error: string | null }> {
	const options: {
		autoRelogin: boolean
		dataDirectory: null
		httpProxy?: string
		socksProxy?: string
	} = { autoRelogin: false, dataDirectory: null }
	if (kind === 'socks5') options.socksProxy = url
	else options.httpProxy = url
	const client = new SteamUser(options)
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false
			const finish = (error?: Error) => {
				if (settled) return
				settled = true
				if (error === undefined) resolve()
				else reject(error)
			}
			const timer = setTimeout(
				() => finish(new Error('timeout waiting for Steam CM loggedOn')),
				30_000,
			)
			client.on('error', (error: Error) => {
				clearTimeout(timer)
				finish(error)
			})
			client.on('loggedOn', () => {
				clearTimeout(timer)
				finish()
			})
			client.logOn({ anonymous: true })
		})
		return { ok: true, error: null }
	} catch (error) {
		return { ok: false, error: errorMessage(error) }
	} finally {
		try {
			client.logOff()
		} catch {
			// already gone
		}
	}
}
