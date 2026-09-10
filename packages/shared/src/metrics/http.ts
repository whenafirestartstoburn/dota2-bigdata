import { collectInventory } from './inventory'
import { CONTENT_TYPE, renderMetrics } from './registry'

export async function metricsResponse(opts?: {
	inventory?: boolean
}): Promise<Response> {
	if (opts?.inventory) await collectInventory()
	return new Response(renderMetrics(), {
		headers: { 'content-type': CONTENT_TYPE },
	})
}
