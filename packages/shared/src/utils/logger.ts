import pino from 'pino'
import env from '#src/utils/env'
import { currentTrace } from '#src/utils/trace'

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

function serviceName(): string {
	const name = process.env.SERVICE_NAME
	return name != null && name !== '' ? name : 'app'
}

export const logger = pino({
	level: env.LOG_LEVEL,
	redact,
	timestamp: pino.stdTimeFunctions.isoTime,
	base: { service: serviceName() },
	formatters: {
		level(label) {
			return { level: label }
		},
	},
	mixin() {
		const trace = currentTrace()
		if (trace == null) return {}
		return {
			trace_id: trace.trace_id,
			...(trace.job != null ? { job: trace.job } : {}),
			...(trace.job_id != null ? { job_id: trace.job_id } : {}),
			...(trace.match_id != null ? { match_id: trace.match_id } : {}),
		}
	},
	...(env.NODE_ENV === 'development' && process.stdout.isTTY === true
		? { transport: { target: 'pino-pretty' } }
		: {}),
})
