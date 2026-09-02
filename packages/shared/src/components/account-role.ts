/** Leftover Guard rows stay in the DB; production GC never picks them. */
export function accountHasGuardSecret(account: {
	sharedSecret: string | null
}): boolean {
	return account.sharedSecret != null && account.sharedSecret !== ''
}

/**
 * GC pool: bought/imported accounts with a password, no Web API key, no
 * shared_secret. Accounts that have a key are for Steam Web API only.
 * Anything else (secret without a key, etc.) is leftover and unused.
 */
export function accountIsGcEligible(account: {
	sharedSecret: string | null
	hasApiKey?: boolean
}): boolean {
	if (accountHasGuardSecret(account)) return false
	if (account.hasApiKey === true) return false
	return true
}

/**
 * Prefer the dedicated GC pool. If it is empty (typical bootstrap: one
 * STEAM_SEED_* row that also holds the Web API key), fall back to a
 * password account without a Guard secret so CMsgGCMatchDetailsRequest
 * can still run.
 */
export function selectGcPool<
	T extends { sharedSecret: string | null; hasApiKey?: boolean },
>(accounts: readonly T[]): T[] {
	const dedicated = accounts.filter((account) => accountIsGcEligible(account))
	if (dedicated.length > 0) return dedicated
	return accounts.filter((account) => !accountHasGuardSecret(account))
}

export function accountHasUsableTotp(account: {
	sharedSecret: string | null
	sharedSecretBroken: boolean
}): boolean {
	return accountHasGuardSecret(account) && !account.sharedSecretBroken
}
