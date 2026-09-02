import { db, sql } from '#src/utils/db'
import env from '#src/utils/env'
import { logger } from '#src/utils/logger'

export async function seedSteamResources(): Promise<void> {
	const login = env.STEAM_SEED_LOGIN.trim()
	const password = env.STEAM_SEED_PASSWORD
	const apiKey = env.STEAM_SEED_API_KEY.trim()
	if (login === '' || password === '') {
		logger.warn('STEAM_SEED_LOGIN/PASSWORD empty — skip account seed')
		return
	}

	const [account] = await db.execute(sql`
		INSERT INTO steam_accounts (
			login, password, shared_secret, identity_secret, status
		) VALUES (
			${login},
			${password},
			${env.STEAM_SEED_SHARED_SECRET.trim() || null},
			${env.STEAM_SEED_IDENTITY_SECRET.trim() || null},
			'ready'
		)
		ON CONFLICT (login) DO UPDATE SET
			password = excluded.password,
			shared_secret = COALESCE(NULLIF(excluded.shared_secret, ''), steam_accounts.shared_secret),
			identity_secret = COALESCE(NULLIF(excluded.identity_secret, ''), steam_accounts.identity_secret),
			shared_secret_broken = CASE
				WHEN NULLIF(excluded.shared_secret, '') IS NOT NULL THEN false
				ELSE steam_accounts.shared_secret_broken
			END,
			updated_at = now()
		RETURNING id
	`)

	if (account === undefined) return

	if (apiKey !== '') {
		await db.execute(sql`
			INSERT INTO steam_api_keys (account_id, api_key, status)
			VALUES (${account.id}, ${apiKey}, 'ready')
			ON CONFLICT (api_key) DO UPDATE SET
				account_id = excluded.account_id,
				status = 'ready',
				updated_at = now()
		`)
	}

	logger.info({ login }, 'seeded steam account from env')
}
