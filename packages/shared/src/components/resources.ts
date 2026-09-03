import { ensureApiKeyProxy } from '#src/components/proxies'
import { jwtExpiresAt, jwtSteamId } from '#src/steam/jwt'
import { asDate, asNumber, asText } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'
import { selectGcPool } from './account-role'

export {
	accountHasGuardSecret,
	accountHasUsableTotp,
	accountIsGcEligible,
	selectGcPool,
} from './account-role'

export type ApiCredential = {
	keyId: number
	accountId: number
	apiKey: string
	proxyId: number
	proxyUrl: string
}

export function steamCtx(cred: ApiCredential, purpose: 'live' | 'historical') {
	return {
		apiKey: cred.apiKey,
		keyId: cred.keyId,
		proxyId: cred.proxyId,
		proxyUrl: cred.proxyUrl,
		purpose,
	}
}

export type GcAccount = {
	id: number
	login: string
	password: string
	sharedSecret: string | null
	sharedSecretBroken: boolean
	identitySecret: string | null
	email: string | null
	emailPassword: string | null
	emailImapHost: string | null
	refreshToken: string | null
	refreshTokenExpiresAt: Date | null
	machineAuthToken: string | null
	steamId: string | null
	proxyId: number | null
	proxyUrl: string | null
	proxyKind: 'http' | 'socks5' | null
	hasApiKey: boolean
}

export function accountCanReadEmailGuard(account: {
	email: string | null
	emailPassword: string | null
	emailImapHost: string | null
}): boolean {
	return (
		account.email != null &&
		account.email !== '' &&
		account.emailPassword != null &&
		account.emailPassword !== '' &&
		account.emailImapHost != null &&
		account.emailImapHost !== ''
	)
}

function mapGcAccount(row: Record<string, unknown>): GcAccount {
	return {
		id: asNumber(row.id) ?? 0,
		login: String(row.login),
		password: String(row.password),
		sharedSecret: asText(row.shared_secret),
		sharedSecretBroken: row.shared_secret_broken === true,
		identitySecret: asText(row.identity_secret),
		email: asText(row.email),
		emailPassword: asText(row.email_password),
		emailImapHost: asText(row.email_imap_host),
		refreshToken: asText(row.refresh_token),
		refreshTokenExpiresAt: asDate(row.refresh_token_expires_at),
		machineAuthToken: asText(row.machine_auth_token),
		steamId: asText(row.steam_id),
		proxyId: asNumber(row.proxy_id),
		proxyUrl: asText(row.proxy_url),
		proxyKind:
			row.proxy_kind === 'socks5' || row.proxy_kind === 'http'
				? row.proxy_kind
				: null,
		hasApiKey: row.has_api_key === true,
	}
}

/** Any ready API key, whether or not the account has a shared_secret. */
export async function pickApiCredential(): Promise<ApiCredential> {
	const rows = await db.execute(sql`
		SELECT
			k.id AS key_id,
			k.account_id,
			k.api_key
		FROM steam_api_keys k
		JOIN steam_accounts a ON a.id = k.account_id
		WHERE k.status IN ('ready', 'active')
			AND (k.rate_limited_until IS NULL OR k.rate_limited_until < now())
			AND a.status IN ('ready', 'active')
		ORDER BY k.last_used_at NULLS FIRST
		LIMIT 1
	`)
	const row = rows[0]
	if (row === undefined) {
		throw new Error(
			'no ready Steam API key in steam_api_keys — seed STEAM_SEED_* or insert a row',
		)
	}
	const keyId = Number(row.key_id)
	const proxy = await ensureApiKeyProxy(keyId)
	await db.execute(sql`
		UPDATE steam_api_keys
		SET last_used_at = now(), status = 'active', updated_at = now()
		WHERE id = ${keyId}
	`)
	return {
		keyId,
		accountId: Number(row.account_id),
		apiKey: String(row.api_key),
		proxyId: proxy.id,
		proxyUrl: proxy.url,
	}
}

export async function apiCredentialForAccount(
	accountId: number,
): Promise<ApiCredential> {
	const [row] = await db.execute(sql`
		SELECT k.id AS key_id, k.account_id, k.api_key
		FROM steam_api_keys k
		WHERE k.account_id = ${accountId}
			AND k.status IN ('ready', 'active')
		ORDER BY k.updated_at DESC
		LIMIT 1
	`)
	if (row === undefined) {
		throw new Error(`no steam_api_keys row for account ${String(accountId)}`)
	}
	const keyId = Number(row.key_id)
	const proxy = await ensureApiKeyProxy(keyId)
	return {
		keyId,
		accountId: Number(row.account_id),
		apiKey: String(row.api_key),
		proxyId: proxy.id,
		proxyUrl: proxy.url,
	}
}

export async function listGcAccounts(limit = 8): Promise<GcAccount[]> {
	const rows = await db.execute(sql`
		SELECT
			a.id,
			a.login,
			a.password,
			a.shared_secret,
			a.shared_secret_broken,
			a.identity_secret,
			a.email,
			a.email_password,
			a.email_imap_host,
			a.refresh_token,
			a.refresh_token_expires_at,
			a.machine_auth_token,
			a.steam_id,
			a.proxy_id,
			p.url AS proxy_url,
			p.kind AS proxy_kind,
			EXISTS (
				SELECT 1 FROM steam_api_keys k WHERE k.account_id = a.id
			) AS has_api_key
		FROM steam_accounts a
		LEFT JOIN proxies p ON p.id = a.proxy_id
			AND p.purpose IN ('gc', 'both')
			AND p.status IN ('ready', 'active')
		WHERE a.status IN ('ready', 'active')
			AND (a.rate_limited_until IS NULL OR a.rate_limited_until < now())
			AND a.password <> ''
			AND (a.shared_secret IS NULL OR a.shared_secret = '')
		ORDER BY
			CASE
				WHEN EXISTS (
					SELECT 1 FROM steam_api_keys k WHERE k.account_id = a.id
				)
				THEN 1
				ELSE 0
			END,
			CASE
				WHEN a.refresh_token IS NOT NULL
					AND a.refresh_token <> ''
					AND (
						a.refresh_token_expires_at IS NULL
						OR a.refresh_token_expires_at > now()
					)
				THEN 0
				ELSE 1
			END,
			a.last_login_at NULLS FIRST,
			a.id
		LIMIT ${limit}
	`)
	return rows.map((row) => mapGcAccount(row as Record<string, unknown>))
}

export async function pickGcAccount(): Promise<GcAccount> {
	const [account] = selectGcPool(await listGcAccounts(8))
	if (account === undefined) {
		throw new Error(
			'no usable Steam account for GC — need a ready account with a password and no shared_secret',
		)
	}
	return account
}

export async function getGcAccount(id: number): Promise<GcAccount | null> {
	const rows = await db.execute(sql`
		SELECT
			a.id,
			a.login,
			a.password,
			a.shared_secret,
			a.shared_secret_broken,
			a.identity_secret,
			a.email,
			a.email_password,
			a.email_imap_host,
			a.refresh_token,
			a.refresh_token_expires_at,
			a.machine_auth_token,
			a.steam_id,
			a.proxy_id,
			p.url AS proxy_url,
			p.kind AS proxy_kind,
			EXISTS (
				SELECT 1 FROM steam_api_keys k WHERE k.account_id = a.id
			) AS has_api_key
		FROM steam_accounts a
		LEFT JOIN proxies p ON p.id = a.proxy_id
			AND p.purpose IN ('gc', 'both')
			AND p.status IN ('ready', 'active')
		WHERE a.id = ${id}
	`)
	const row = rows[0]
	return row === undefined ? null : mapGcAccount(row as Record<string, unknown>)
}

export async function getGcAccountByLogin(
	login: string,
): Promise<GcAccount | null> {
	const rows = await db.execute(sql`
		SELECT
			a.id,
			a.login,
			a.password,
			a.shared_secret,
			a.shared_secret_broken,
			a.identity_secret,
			a.email,
			a.email_password,
			a.email_imap_host,
			a.refresh_token,
			a.refresh_token_expires_at,
			a.machine_auth_token,
			a.steam_id,
			a.proxy_id,
			p.url AS proxy_url,
			p.kind AS proxy_kind,
			EXISTS (
				SELECT 1 FROM steam_api_keys k WHERE k.account_id = a.id
			) AS has_api_key
		FROM steam_accounts a
		LEFT JOIN proxies p ON p.id = a.proxy_id
			AND p.purpose IN ('gc', 'both')
			AND p.status IN ('ready', 'active')
		WHERE a.login = ${login}
	`)
	const row = rows[0]
	return row === undefined ? null : mapGcAccount(row as Record<string, unknown>)
}

export async function getSteamMailbox(login: string): Promise<{
	email: string
	emailPassword: string
	emailImapHost: string | null
} | null> {
	const rows = await db.execute(sql`
		SELECT email, email_password, email_imap_host
		FROM steam_accounts
		WHERE login = ${login}
	`)
	const row = rows[0]
	const email = asText(row?.email)
	const emailPassword = asText(row?.email_password)
	if (email === null || emailPassword === null) return null
	return {
		email,
		emailPassword,
		emailImapHost: asText(row?.email_imap_host),
	}
}

export async function markAccountError(
	accountId: number,
	error: string,
	opts?: { disable?: boolean; rateLimitMs?: number },
): Promise<void> {
	const status = opts?.disable
		? 'disabled'
		: opts?.rateLimitMs
			? 'rate_limited'
			: 'ready'
	const until =
		opts?.rateLimitMs === undefined
			? null
			: new Date(Date.now() + opts.rateLimitMs)
	await db.execute(sql`
		UPDATE steam_accounts
		SET
			status = ${status}::resource_status,
			last_error = ${error},
			rate_limited_until = ${until},
			updated_at = now()
		WHERE id = ${accountId}
	`)
}

export async function markAccountLogin(
	accountId: number,
	opts?: { totpOk?: boolean },
): Promise<void> {
	const totpOk = opts?.totpOk === true
	await db.execute(sql`
		UPDATE steam_accounts
		SET last_login_at = now(),
			status = 'active',
			shared_secret_broken = CASE
				WHEN ${totpOk} THEN false
				ELSE shared_secret_broken
			END,
			last_error = NULL,
			updated_at = now()
		WHERE id = ${accountId}
	`)
}

export async function markSharedSecretBroken(
	accountId: number,
	reason: string,
): Promise<void> {
	await db.execute(sql`
		UPDATE steam_accounts
		SET
			shared_secret_broken = true,
			last_error = ${reason},
			updated_at = now()
		WHERE id = ${accountId}
			AND shared_secret IS NOT NULL
			AND shared_secret <> ''
	`)
}

export async function saveSteamSession(input: {
	accountId: number
	refreshToken?: string | null
	machineAuthToken?: string | null
	steamId?: string | null
}): Promise<void> {
	if (input.refreshToken != null && input.refreshToken !== '') {
		const expires = jwtExpiresAt(input.refreshToken)
		const steamId = input.steamId ?? jwtSteamId(input.refreshToken)
		await db.execute(sql`
			UPDATE steam_accounts
			SET
				refresh_token = ${input.refreshToken},
				refresh_token_expires_at = ${expires},
				steam_id = COALESCE(${steamId}, steam_id),
				updated_at = now()
			WHERE id = ${input.accountId}
		`)
	}
	if (input.machineAuthToken != null && input.machineAuthToken !== '') {
		await db.execute(sql`
			UPDATE steam_accounts
			SET machine_auth_token = ${input.machineAuthToken}, updated_at = now()
			WHERE id = ${input.accountId}
		`)
	}
	if (
		(input.refreshToken == null || input.refreshToken === '') &&
		input.steamId != null &&
		input.steamId !== ''
	) {
		await db.execute(sql`
			UPDATE steam_accounts
			SET steam_id = ${input.steamId}, updated_at = now()
			WHERE id = ${input.accountId}
		`)
	}
}

export async function clearRefreshToken(accountId: number): Promise<void> {
	await db.execute(sql`
		UPDATE steam_accounts
		SET
			refresh_token = NULL,
			refresh_token_expires_at = NULL,
			updated_at = now()
		WHERE id = ${accountId}
	`)
}

export async function upsertSteamAccount(input: {
	login: string
	password?: string
	sharedSecret?: string | null
	identitySecret?: string | null
	email?: string | null
	emailPassword?: string | null
	emailImapHost?: string | null
}): Promise<number> {
	const [row] = await db.execute(sql`
		INSERT INTO steam_accounts (
			login, password, shared_secret, identity_secret,
			email, email_password, email_imap_host, status
		) VALUES (
			${input.login},
			${input.password ?? ''},
			${input.sharedSecret ?? null},
			${input.identitySecret ?? null},
			${input.email ?? null},
			${input.emailPassword ?? null},
			${input.emailImapHost ?? null},
			'ready'
		)
		ON CONFLICT (login) DO UPDATE SET
			password = CASE
				WHEN excluded.password = '' THEN steam_accounts.password
				ELSE excluded.password
			END,
			shared_secret = COALESCE(
				NULLIF(excluded.shared_secret, ''),
				steam_accounts.shared_secret
			),
			identity_secret = COALESCE(
				excluded.identity_secret,
				steam_accounts.identity_secret
			),
			email = COALESCE(NULLIF(excluded.email, ''), steam_accounts.email),
			email_password = CASE
				WHEN excluded.email_password IS NULL OR excluded.email_password = ''
				THEN steam_accounts.email_password
				ELSE excluded.email_password
			END,
			email_imap_host = COALESCE(
				NULLIF(excluded.email_imap_host, ''),
				steam_accounts.email_imap_host
			),
			shared_secret_broken = CASE
				WHEN NULLIF(excluded.shared_secret, '') IS NOT NULL THEN false
				ELSE steam_accounts.shared_secret_broken
			END,
			status = 'ready',
			last_error = CASE
				WHEN NULLIF(excluded.shared_secret, '') IS NOT NULL THEN NULL
				ELSE steam_accounts.last_error
			END,
			rate_limited_until = NULL,
			updated_at = now()
		RETURNING id
	`)
	if (row === undefined) {
		throw new Error(`failed to upsert steam_accounts.login=${input.login}`)
	}
	return Number(row.id)
}

export async function saveApiKey(input: {
	accountId: number
	apiKey: string
}): Promise<void> {
	await db.execute(sql`
		INSERT INTO steam_api_keys (account_id, api_key, status)
		VALUES (${input.accountId}, ${input.apiKey}, 'ready')
		ON CONFLICT (api_key) DO UPDATE SET
			account_id = excluded.account_id,
			status = 'ready',
			last_error = NULL,
			updated_at = now()
	`)
}

export async function saveSharedSecret(input: {
	login: string
	password?: string
	sharedSecret: string
	identitySecret?: string
}): Promise<void> {
	await upsertSteamAccount({
		login: input.login,
		password: input.password,
		sharedSecret: input.sharedSecret,
		identitySecret: input.identitySecret,
	})
}
