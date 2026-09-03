import {
	ensureAccountProxy,
	pickReadyProxy,
	proxyHostPort,
} from '#src/components/proxies'
import {
	apiCredentialForAccount,
	getGcAccountByLogin,
	steamCtx,
	upsertSteamAccount,
} from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import {
	isOutlookMailer,
	OutlookImapError,
	resolveImapHost,
	UnknownMailerError,
} from '#src/marketplace/imap-host'
import {
	finishMarketplaceOrder,
	insertMarketplaceOrder,
	markMarketplaceOrderPending,
	setMarketplaceExternalId,
} from '#src/marketplace/orders'
import {
	describeBoughtAccount,
	parseBoughtSteamAccounts,
} from '#src/marketplace/parse-account'
import { assertBuyableProduct } from '#src/marketplace/products'
import {
	DarkShoppingError,
	type MarketplaceStoreId,
	marketplaceConfigured,
	purchaseFromMarketplace,
} from '#src/marketplace/store'
import { loginGcAndMaybeTest } from '#src/steam/gc-probe'
import { runWithProxy } from '#src/steam/http'
import { issueApiKeyForLogin } from '#src/steam/provision-api-key'
import { getLiveLeagueGames } from '#src/steam/web-api'
import { asNumber, errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'
import { type StatusFn, status, withStatus } from '#src/utils/status'

export type BuyAccountInput = {
	productId: number
	store: MarketplaceStoreId
	type: 'api_key' | 'gc'
	count: number
	testOnMatchId?: number
	imapHost?: string
	onStatus?: StatusFn
}

export function parseBuyAccountCliInput(flags: {
	productId?: string
	type?: string
	store?: string
	count?: string
	testOnMatchId?: string
	imapHost?: string
}): BuyAccountInput {
	const productId = asNumber(flags.productId)
	if (productId === null || productId <= 0) {
		throw new Error('--product-id is required (positive integer)')
	}
	const kind = flags.type
	if (kind !== 'api_key' && kind !== 'gc') {
		throw new Error('--type must be api_key or gc')
	}
	const store = flags.store ?? 'dark_shopping'
	if (store !== 'dark_shopping') {
		throw new Error(`unsupported --store ${store}`)
	}
	const count = asNumber(flags.count) ?? 1
	if (!Number.isInteger(count) || count < 1) {
		throw new Error('--count must be a positive integer')
	}
	const testOnMatchId = asNumber(flags.testOnMatchId)
	if (
		flags.testOnMatchId != null &&
		flags.testOnMatchId !== '' &&
		(testOnMatchId === null || testOnMatchId <= 0)
	) {
		throw new Error('--test-on-match-id must be a positive integer')
	}
	const imapHost = flags.imapHost?.trim() ?? ''
	return {
		productId,
		store,
		type: kind,
		count,
		...(testOnMatchId != null && testOnMatchId > 0 ? { testOnMatchId } : {}),
		...(imapHost !== '' ? { imapHost } : {}),
	}
}

export type BuyAccountTestResult = {
	replayUrl?: string
	liveGamesIds?: number[]
}

export type BuyAccountOrderResult = {
	id: number
	status: 'success' | 'failed' | 'pending'
	productId: number
	store: MarketplaceStoreId
	errorMessage: string | null
	testResult: BuyAccountTestResult | null
}

export function classifyPurchaseError(error: unknown): {
	status: 'failed' | 'pending'
	errorMessage: string
} {
	if (error instanceof DarkShoppingError && error.status === 408) {
		return { status: 'pending', errorMessage: error.message }
	}
	if (
		error instanceof OutlookImapError ||
		error instanceof UnknownMailerError
	) {
		return { status: 'failed', errorMessage: error.message }
	}
	return { status: 'failed', errorMessage: errorMessage(error) }
}

async function persistBoughtAccount(input: {
	login: string
	password: string
	email: string
	emailPassword: string
	kind: 'api_key' | 'gc'
	imapHost?: string
}): Promise<{ accountId: number; imapHost: string | null }> {
	const accountId = await upsertSteamAccount({
		login: input.login,
		password: input.password,
		email: input.email,
		emailPassword: input.emailPassword,
	})
	status(
		`steam_accounts: upserted id=${String(accountId)} login=${input.login}`,
	)
	if (input.kind === 'api_key' && isOutlookMailer(input.email)) {
		throw new OutlookImapError(input.email)
	}
	const explicit = input.imapHost?.trim() ?? ''
	if (explicit !== '') {
		status(`imap: using --imap-host ${explicit} for ${input.email}`)
		const resolved = await resolveImapHost({
			email: input.email,
			password: input.emailPassword,
			host: explicit,
		})
		await upsertSteamAccount({
			login: input.login,
			emailImapHost: resolved.host,
		})
		return { accountId, imapHost: resolved.host }
	}
	let imapHost: string | null = null
	if (!isOutlookMailer(input.email)) {
		try {
			status(`imap: resolving host for ${input.email}`)
			const resolved = await resolveImapHost({
				email: input.email,
				password: input.emailPassword,
			})
			imapHost = resolved.host
			status(`imap: LOGIN ok at ${imapHost}`)
			await upsertSteamAccount({
				login: input.login,
				emailImapHost: imapHost,
			})
		} catch (error) {
			if (input.kind === 'api_key') throw error
			status(
				`imap: probe failed for ${input.login}; GC login may still work without mailbox`,
			)
			logger.warn(
				{ login: input.login, err: errorMessage(error) },
				'IMAP probe failed; GC login may still work without mailbox',
			)
		}
	}
	return { accountId, imapHost }
}

async function testIssuedApiKey(accountId: number): Promise<number[]> {
	const cred = await apiCredentialForAccount(accountId)
	const { games } = await getLiveLeagueGames(steamCtx(cred, 'live'))
	return games.map((game) => game.match_id)
}

async function provisionOrder(input: {
	kind: 'api_key' | 'gc'
	testOnMatchId: number | null
	login: string
	accountId: number
}): Promise<BuyAccountTestResult> {
	if (input.kind === 'api_key') {
		const proxy = await pickReadyProxy('api')
		status(
			`steam: issuing Web API key for ${input.login} via ${proxyHostPort(proxy.url)}`,
		)
		await runWithProxy(proxy.url, () =>
			issueApiKeyForLogin({ login: input.login }),
		)
		status(`steam: GetLiveLeagueGames for ${input.login}`)
		const liveGamesIds = await testIssuedApiKey(input.accountId)
		status(
			`steam: GetLiveLeagueGames → ${String(liveGamesIds.length)} live match ids`,
		)
		return { liveGamesIds }
	}
	const bound = await ensureAccountProxy({
		accountId: input.accountId,
		proxyId: (await getGcAccountByLogin(input.login))?.proxyId ?? null,
	})
	status(
		`gc: login ${input.login} via proxy id=${String(bound.id)} ${proxyHostPort(bound.url)}`,
	)
	const probed = await loginGcAndMaybeTest({
		login: input.login,
		testOnMatchId: input.testOnMatchId,
	})
	const testResult: BuyAccountTestResult = {}
	if (probed.replayUrl != null) testResult.replayUrl = probed.replayUrl
	return testResult
}

async function buyOne(
	input: BuyAccountInput & { timeoutMs: number },
): Promise<BuyAccountOrderResult> {
	const testOnMatchId = input.testOnMatchId ?? null
	const order = await insertMarketplaceOrder({
		store: input.store,
		kind: input.type,
		productId: input.productId,
		testOnMatchId,
	})
	status(
		`buy-account: local order ${order.id} product=${String(input.productId)} type=${input.type}`,
	)
	let steamAccountId: number | null = null
	try {
		const purchased = await purchaseFromMarketplace({
			store: input.store,
			productId: input.productId,
			idempotenceId: order.idempotenceId,
			timeoutMs: input.timeoutMs,
		})
		await setMarketplaceExternalId(order.id, purchased.externalOrderId)
		const accounts = parseBoughtSteamAccounts(purchased.deliveryText)
		const bought = accounts[0]
		if (bought === undefined) {
			throw new Error(
				'dark.shopping delivery did not contain Steam login/password/email credentials',
			)
		}
		status(`bought: ${describeBoughtAccount(bought)}`)
		let persisted: { accountId: number; imapHost: string | null }
		try {
			persisted = await persistBoughtAccount({
				...bought,
				kind: input.type,
				imapHost: input.imapHost,
			})
		} catch (error) {
			const existing = await getGcAccountByLogin(bought.login)
			if (existing != null) steamAccountId = existing.id
			throw error
		}
		steamAccountId = persisted.accountId
		const testResult = await provisionOrder({
			kind: input.type,
			testOnMatchId,
			login: bought.login,
			accountId: persisted.accountId,
		})
		await finishMarketplaceOrder({
			id: order.id,
			status: 'success',
			steamAccountId,
			testResult,
		})
		status(`buy-account: order ${order.id} success login=${bought.login}`)
		return {
			id: order.id,
			status: 'success',
			productId: input.productId,
			store: input.store,
			errorMessage: null,
			testResult,
		}
	} catch (error) {
		const classified = classifyPurchaseError(error)
		status(
			`buy-account: order ${order.id} ${classified.status}: ${classified.errorMessage}`,
		)
		logger.warn(
			{
				orderId: order.id,
				productId: input.productId,
				status: classified.status,
				err: classified.errorMessage,
			},
			'buy-account order did not succeed',
		)
		if (classified.status === 'pending') {
			await markMarketplaceOrderPending({
				id: order.id,
				errorMessage: classified.errorMessage,
			})
			return {
				id: order.id,
				status: 'pending',
				productId: input.productId,
				store: input.store,
				errorMessage: classified.errorMessage,
				testResult: null,
			}
		}
		await finishMarketplaceOrder({
			id: order.id,
			status: 'failed',
			steamAccountId,
			errorMessage: classified.errorMessage,
		})
		return {
			id: order.id,
			status: 'failed',
			productId: input.productId,
			store: input.store,
			errorMessage: classified.errorMessage,
			testResult: null,
		}
	}
}

export async function buyAccounts(
	input: BuyAccountInput,
): Promise<{ orders: BuyAccountOrderResult[] }> {
	if (!marketplaceConfigured(input.store)) {
		throw new DarkShoppingError(
			503,
			`marketplace ${input.store} is not configured (missing API key)`,
		)
	}
	await assertBuyableProduct({
		store: input.store,
		productId: input.productId,
		type: input.type,
	})
	const settings = await getAppSettings()
	if (
		!Number.isInteger(input.count) ||
		input.count < 1 ||
		input.count > settings.marketplaceBuyMax
	) {
		throw new Error(`count must be 1..${String(settings.marketplaceBuyMax)}`)
	}
	const count = input.count
	return withStatus(input.onStatus, async () => {
		const orders: BuyAccountOrderResult[] = []
		for (let i = 0; i < count; i++) {
			if (count > 1) {
				status(`buy-account: purchasing ${String(i + 1)}/${String(count)}`)
			}
			orders.push(
				await buyOne({ ...input, timeoutMs: settings.marketplaceWaitMs }),
			)
		}
		return { orders }
	})
}
