export class SharedSecretBrokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SharedSecretBrokenError'
	}
}

export function steamGuardMeansBrokenSecret(input: {
	domain: string | null | undefined
	lastCodeWrong: boolean
	hasUsableTotp: boolean
}): boolean {
	if (!input.hasUsableTotp) return false
	const email = input.domain != null && input.domain !== ''
	if (email) return false
	return input.lastCodeWrong
}

export function isGcWelcomeTimeout(error: unknown): boolean {
	return (
		error instanceof Error && /timeout waiting for Dota GC/i.test(error.message)
	)
}

export function isImapBasicAuthDisabled(error: unknown): boolean {
	return (
		error instanceof Error &&
		/basic authentication is disabled/i.test(error.message)
	)
}

export function isNoUsableGcAccount(error: unknown): boolean {
	if (error instanceof SharedSecretBrokenError) return true
	return (
		error instanceof Error &&
		error.message.startsWith('no usable Steam account')
	)
}
