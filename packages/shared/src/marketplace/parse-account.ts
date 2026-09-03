export type BoughtSteamAccount = {
	login: string
	password: string
	email: string
	emailPassword: string
}

const LINE_RE = /^([^\s:]+):([^:\s]+):([^@\s]+@[^:\s]+):(\S+)\s*$/
const LABELED_LOGIN = /Login Steam:\s*(\S+)/i
const LABELED_PASSWORD = /Password Steam:\s*(\S+)/i
const LABELED_EMAIL = /Email Login:\s*(\S+)/i
const LABELED_EMAIL_PASSWORD = /Email Password:\s*(\S+)/i

function accountFromMatch(
	login: string | undefined,
	password: string | undefined,
	email: string | undefined,
	emailPassword: string | undefined,
): BoughtSteamAccount | null {
	if (
		login === undefined ||
		password === undefined ||
		email === undefined ||
		emailPassword === undefined
	) {
		return null
	}
	if (!email.includes('@')) return null
	return { login, password, email, emailPassword }
}

function parseColonLine(line: string): BoughtSteamAccount | null {
	const match = LINE_RE.exec(line)
	if (match === null) return null
	return accountFromMatch(match[1], match[2], match[3], match[4])
}

function parseLabeledAccount(text: string): BoughtSteamAccount | null {
	return accountFromMatch(
		LABELED_LOGIN.exec(text)?.[1],
		LABELED_PASSWORD.exec(text)?.[1],
		LABELED_EMAIL.exec(text)?.[1],
		LABELED_EMAIL_PASSWORD.exec(text)?.[1],
	)
}

/** Credentials from a Dark Shopping delivery file. */
export function parseBoughtSteamAccounts(text: string): BoughtSteamAccount[] {
	const cut = text.search(/Ваш заказ:/i)
	const body = cut < 0 ? text : text.slice(cut)
	const accounts: BoughtSteamAccount[] = []
	const seen = new Set<string>()
	const push = (account: BoughtSteamAccount | null): void => {
		if (account === null || seen.has(account.login)) return
		seen.add(account.login)
		accounts.push(account)
	}
	for (const raw of body.split(/\r?\n/)) {
		push(parseColonLine(raw.trim()))
	}
	push(parseLabeledAccount(body))
	return accounts
}

export function describeBoughtAccount(account: BoughtSteamAccount): string {
	return `login=${account.login} email=${account.email}`
}

/** Replace password fields in known delivery formats. */
export function redactBoughtDelivery(text: string): string {
	return text
		.replace(
			/^([^\s:]+):([^:\s]+):([^@\s]+@[^:\s]+):(\S+)\s*$/gm,
			'$1:***:$3:***',
		)
		.replace(/(Password Steam:\s*)(\S+)/gi, '$1***')
		.replace(/(Email Password:\s*)(\S+)/gi, '$1***')
}
