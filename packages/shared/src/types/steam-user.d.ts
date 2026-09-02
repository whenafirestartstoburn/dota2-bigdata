declare module 'steam-user' {
	type SteamEventFn = (...args: never[]) => void

	class SteamUser {
		constructor(options?: {
			autoRelogin?: boolean
			httpProxy?: string
			socksProxy?: string
			renewRefreshTokens?: boolean
			dataDirectory?: string | null
		})
		steamID: { getSteamID64(): string } | null
		on(event: 'error', listener: (error: Error) => void): this
		on(
			event: 'steamGuard',
			listener: (
				domain: string | null,
				callback: (code: string) => void,
				lastCodeWrong: boolean,
			) => void,
		): this
		on(event: 'loggedOn', listener: () => void): this
		on(event: 'appLaunched', listener: (appId: number) => void): this
		on(
			event: 'receivedFromGC',
			listener: (appId: number, msgType: number, body: Buffer) => void,
		): this
		on(event: 'disconnected', listener: () => void): this
		on(event: 'refreshToken', listener: (token: string) => void): this
		on(event: 'machineAuthToken', listener: (token: string) => void): this
		on(event: string, listener: SteamEventFn): this
		once(event: string, listener: SteamEventFn): this
		removeListener(event: string, listener: SteamEventFn): this
		logOn(details: {
			accountName?: string
			password?: string
			refreshToken?: string
			steamID?: string
			twoFactorCode?: string
			authCode?: string
			machineAuthToken?: string
		}): void
		logOff(): void
		setPersona(state: number): void
		gamesPlayed(
			appId: number | Array<number | { game_id: number }>,
			force?: boolean,
		): void
		sendToGC(
			appId: number,
			msgType: number,
			protoHeader: object,
			payload: Buffer,
			callback?: (appId: number, msgType: number, payload: Buffer) => void,
		): void
		enableTwoFactor(): Promise<{
			status: number
			shared_secret: string
			identity_secret: string
			revocation_code: string
		}>
		finalizeTwoFactor(secret: string, activationCode: string): Promise<void>
	}

	export = SteamUser
}
