import { collectInventory } from './inventory'
import { CONTENT_TYPE, renderMetrics } from './registry'

export async function metricsResponse(): Promise<Response> {
	await collectInventory()
	return new Response(renderMetrics(), {
		headers: { 'content-type': CONTENT_TYPE },
	})
}
