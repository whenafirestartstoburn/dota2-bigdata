/** Quote 16+ digit integers so uint64 ids survive JSON.parse. */
export function parseSteamJson(text: string): unknown {
	return JSON.parse(
		text.replace(/([:[,]\s*)(\d{16,})(\s*[,}\]])/g, '$1"$2"$3'),
	) as unknown
}
