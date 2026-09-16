import {
	DOTA_APP_ID,
	decodeMatchDetailsResponse,
	encodeMatchDetailsRequest,
	GC_ERESULT,
	GC_MSG,
	type GcMatchReplayLocator,
} from '#src/gc/protobuf'
import { truncateErrorResponse, withRequestLog } from '#src/store/request-logs'

export type GcSendClient = {
	sendToGC: (
		appId: number,
		msgType: number,
		protoBufHeader: object,
		payload: Buffer,
		callback?: (appId: number, msgType: number, payload: Buffer) => void,
	) => void
}

const GC_TIMEOUT_MS = 15_000

export async function sendGcMatchDetailsRequest(
	client: GcSendClient,
	matchId: number,
	actor?: { accountId?: number | null },
): Promise<GcMatchReplayLocator> {
	return withRequestLog(
		'steam_gc_requests',
		{
			matchId,
			methodName: 'CMsgGCMatchDetailsRequest',
			steamAccountId: actor?.accountId ?? null,
		},
		async () => {
			const payload = encodeMatchDetailsRequest(matchId)
			const buffer = await new Promise<Buffer>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error(`GC match details timeout for ${matchId}`)),
					GC_TIMEOUT_MS,
				)
				client.sendToGC(
					DOTA_APP_ID,
					GC_MSG.matchDetailsRequest,
					{},
					payload,
					(_appId, _msgType, body) => {
						clearTimeout(timer)
						resolve(Buffer.from(body))
					},
				)
			})
			const locator = decodeMatchDetailsResponse(buffer)
			return {
				value: locator,
				responseStatus: String(locator.result),
				responseSizeKb: buffer.length / 1024,
				errorResponse:
					locator.result === GC_ERESULT.ok
						? null
						: truncateErrorResponse(`GC result ${locator.result}`),
			}
		},
	)
}
