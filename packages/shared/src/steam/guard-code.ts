const TOTP_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY'

export function decodeQuotedPrintable(input: string): string {
	return input
		.replace(/=\r?\n/g, '')
		.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
			String.fromCharCode(Number.parseInt(hex, 16)),
		)
}

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&nbsp;/gi, ' ')
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
			String.fromCharCode(Number.parseInt(n, 16)),
		)
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
}

function rfc822Payload(raw: string): string {
	const idx = raw.search(/\r?\n\r?\n/)
	return idx < 0 ? raw : raw.slice(idx)
}

export function emailBodyToText(raw: string): string {
	const decoded = decodeQuotedPrintable(rfc822Payload(raw))
	return decodeHtmlEntities(
		decoded
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
			.replace(/<[^>]+>/g, ' '),
	)
		.replace(/\s+/g, ' ')
		.trim()
}

function asCode(value: string): string {
	return value.toUpperCase()
}

function totpTokenRe(flags: string): RegExp {
	return new RegExp(`\\b([${TOTP_ALPHABET}]{5})\\b`, flags)
}

/**
 * Pull the 5-character Steam Guard code out of a raw RFC822 / HTML body.
 * Prefers a token next to "Steam Guard" / "code"; falls back to the last
 * standalone TOTP-alphabet word so a markup-only mail still works.
 */
export function extractSteamGuardCode(raw: string): string | null {
	const text = emailBodyToText(raw)
	const labeled = new RegExp(
		`steam\\s*guard(?:\\s*code)?[\\s\\S]{0,400}?${totpTokenRe('').source}`,
		'i',
	).exec(text)
	if (labeled?.[1] !== undefined) return asCode(labeled[1])

	const nearCode = new RegExp(
		`\\bcode\\b[\\s\\S]{0,80}?${totpTokenRe('').source}`,
		'i',
	).exec(text)
	if (nearCode?.[1] !== undefined) return asCode(nearCode[1])

	const all = [...text.matchAll(totpTokenRe('gi'))]
	const last = all.at(-1)?.[1]
	return last === undefined ? null : asCode(last)
}

/** Steam HTML tracking path, language-independent. */
export type SteamGuardMailKind = 'login' | 'authenticator'

export type ParsedSteamMail = {
	kind: SteamGuardMailKind | 'other'
	template: string | null
	code: string | null
}

/**
 * Steam puts the English template name in
 * `store.steampowered.com/email/<Template>`. Subjects and From display
 * names follow the account language and cannot be used to classify.
 */
export function steamEmailTemplateName(raw: string): string | null {
	const decoded = decodeQuotedPrintable(rfc822Payload(raw))
	const match = /store\.steampowered\.com\/email\/([A-Za-z0-9_-]+)/i.exec(
		decoded,
	)
	return match?.[1] ?? null
}

function kindFromTemplate(
	template: string | null,
	raw: string,
): SteamGuardMailKind | 'other' {
	const name = template?.toLowerCase() ?? ''
	if (name === 'authenticatoradd') return 'authenticator'
	if (name.startsWith('codefor')) return 'login'
	const decoded = decodeQuotedPrintable(rfc822Payload(raw))
	if (/HelpUnauthorizedLogin/i.test(decoded)) return 'login'
	return 'other'
}

export function parseSteamMail(raw: string): ParsedSteamMail {
	const template = steamEmailTemplateName(raw)
	const kind = kindFromTemplate(template, raw)
	if (kind === 'other') {
		return { kind, template, code: null }
	}
	return { kind, template, code: extractSteamGuardCode(raw) }
}
