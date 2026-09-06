import { describe, expect, test } from 'bun:test'
import {
	assertBuyableProduct,
	getWhitelistedProduct,
	getWhitelistedProductByKind,
	UnknownProductError,
} from '#src/marketplace/products'

describe('marketplace_products whitelist', () => {
	test('seeds Dark Shopping api_key and gc goods', async () => {
		const api = await getWhitelistedProduct('dark_shopping', 80841)
		expect(api?.kind).toBe('api_key')
		expect(api?.productId).toBe(80841)
		const gc = await getWhitelistedProductByKind('dark_shopping', 'gc')
		expect(gc?.productId).toBe(160811)
	})

	test('assertBuyableProduct rejects unknown and kind mismatch', async () => {
		await expect(
			assertBuyableProduct({
				store: 'dark_shopping',
				productId: 1,
				type: 'gc',
			}),
		).rejects.toBeInstanceOf(UnknownProductError)
		await expect(
			assertBuyableProduct({
				store: 'dark_shopping',
				productId: 80841,
				type: 'gc',
			}),
		).rejects.toBeInstanceOf(UnknownProductError)
		const ok = await assertBuyableProduct({
			store: 'dark_shopping',
			productId: 80841,
			type: 'api_key',
		})
		expect(ok.productId).toBe(80841)
	})
})
