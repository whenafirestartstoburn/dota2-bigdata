import pino from 'pino'
import env from '#src/utils/env'

const redact = {
	paths: [
		'password',
		'*.password',
		'shared_secret',
		'*.shared_secret',
		'identity_secret',
		'*.identity_secret',
		'email_password',
		'*.email_password',
		'refresh_token',
		'*.refresh_token',
		'machine_auth_token',
		'*.machine_auth_token',
		'api_key',
		'*.api_key',
		'proxyUrl',
		'*.proxyUrl',
		'proxy_url',
		'*.proxy_url',
		'STEAM_SEED_PASSWORD',
		'S3_SECRET_KEY',
	],
	censor: '[redacted]',
}

export const logger =
	env.NODE_ENV === 'development'
		? pino({
				level: env.LOG_LEVEL,
				redact,
				transport: { target: 'pino-pretty' },
			})
		: pino({ level: env.LOG_LEVEL, redact })
