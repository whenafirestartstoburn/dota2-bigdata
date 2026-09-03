import {
	type BoundProxy,
	isProxyUsable,
	type ProxyKind,
	type ProxyPurpose,
	pickReadyProxy,
} from '#src/components/proxies'
import { probeProxyApi, probeProxyGc } from '#src/components/proxy-probe'
import {
	bumpResourceRetest,
	restoreResource,
} from '#src/components/resource-health'
import { getAppSettings } from '#src/components/settings'
import { loginGcAndMaybeTest } from '#src/steam/gc-probe'
import { getLiveLeagueGames } from '#src/steam/web-api'
import { asNumber, asText, errorMessage } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'
import { logger } from '#src/utils/logger'

function asKind(value: unknown): ProxyKind | null {
	return value === 'socks5' || value === 'http' ? value : null
}

function asPurpose(value: unknown): ProxyPurpose | null {
	return value === 'api' || value === 'gc' || value === 'both' ? value : null
}

export async function runRetestDisabledResources(): Promise<void> {
	const settings = await getAppSettings()
	await retestProxies(settings.proxyRetestMax)
	await retestGcAccounts(settings.gcAccountRetestMax)
	await retestApiKeys(settings.apiKeyRetestMax)
}

async function retestProxies(max: number): Promise<void> {
	const rows = await db.execute(sql`
		SELECT id, url, kind, purpose
		FROM proxies
		WHERE status = 'disabled'::resource_status
			AND retest_count < ${max}
		ORDER BY id
	`)
	for (const raw of rows) {
		const id = asNumber(raw.id)
		const url = asText(raw.url)
		const kind = asKind(raw.kind)
		const purpose = asPurpose(raw.purpose)
		if (id === null || url === null || kind === null || purpose === null) {
			continue
		}
		const proxy: Pick<BoundProxy, 'id' | 'url' | 'kind' | 'purpose'> = {
			id,
			url,
			kind,
			purpose,
		}
		try {
			const ok = await probeDisabledProxy(proxy)
			if (ok) {
				await restoreResource({ kind: 'proxy', resourceId: id })
				logger.info({ proxyId: id, host: url }, 'retest restored proxy')
				continue
			}
			await bumpResourceRetest({
				kind: 'proxy',
				resourceId: id,
				error: 'retest failed',
			})
		} catch (error) {
			await bumpResourceRetest({
				kind: 'proxy',
				resourceId: id,
				error: errorMessage(error),
			})
		}
	}
}

async function probeDisabledProxy(proxy: {
	url: string
	kind: ProxyKind
	purpose: ProxyPurpose
}): Promise<boolean> {
	if (proxy.purpose === 'api' || proxy.purpose === 'both') {
		const api = await probeProxyApi(proxy.url)
		if (!api.ok) return false
		if (proxy.purpose === 'api') return true
	}
	if (proxy.purpose === 'gc' || proxy.purpose === 'both') {
		const gc = await probeProxyGc(proxy.kind, proxy.url)
		if (!gc.ok) return false
	}
	return true
}

async function retestGcAccounts(max: number): Promise<void> {
	const rows = await db.execute(sql`
		SELECT id, login
		FROM steam_accounts a
		WHERE a.status = 'disabled'::resource_status
			AND a.retest_count < ${max}
			AND (a.shared_secret IS NULL OR a.shared_secret = '')
			AND NOT EXISTS (
				SELECT 1 FROM steam_api_keys k WHERE k.account_id = a.id
			)
		ORDER BY a.id
	`)
	for (const raw of rows) {
		const id = asNumber(raw.id)
		const login = asText(raw.login)
		if (id === null || login === null) continue
		try {
			await loginGcAndMaybeTest({ login, testOnMatchId: null })
			await restoreResource({ kind: 'gc_account', resourceId: id })
			logger.info({ accountId: id, login }, 'retest restored GC account')
		} catch (error) {
			await bumpResourceRetest({
				kind: 'gc_account',
				resourceId: id,
				error: errorMessage(error),
			})
		}
	}
}

async function retestApiKeys(max: number): Promise<void> {
	const rows = await db.execute(sql`
		SELECT id, account_id, api_key, proxy_id
		FROM steam_api_keys
		WHERE status = 'disabled'::resource_status
			AND retest_count < ${max}
		ORDER BY id
	`)
	for (const raw of rows) {
		const id = asNumber(raw.id)
		const accountId = asNumber(raw.account_id)
		const apiKey = asText(raw.api_key)
		if (id === null || accountId === null || apiKey === null) continue
		try {
			let proxyId = asNumber(raw.proxy_id)
			let proxyUrl: string | null = null
			if (proxyId !== null && (await isProxyUsable(proxyId, 'api'))) {
				const [bound] = await db.execute(sql`
					SELECT url FROM proxies WHERE id = ${proxyId}
				`)
				proxyUrl = asText(bound?.url)
			}
			if (proxyUrl === null) {
				const picked = await pickReadyProxy('api')
				proxyId = picked.id
				proxyUrl = picked.url
			}
			if (proxyId === null) continue
			await getLiveLeagueGames({
				apiKey,
				keyId: id,
				proxyId,
				proxyUrl,
				purpose: 'live',
			})
			await restoreResource({ kind: 'api_key', resourceId: id })
			logger.info({ keyId: id }, 'retest restored API key')
		} catch (error) {
			await bumpResourceRetest({
				kind: 'api_key',
				resourceId: id,
				error: errorMessage(error),
			})
		}
	}
}
