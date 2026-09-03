-- migrate:up
CREATE TYPE marketplace_store AS ENUM ('dark_shopping');
CREATE TYPE account_purchase_kind AS ENUM ('api_key', 'gc');
CREATE TYPE marketplace_order_status AS ENUM ('pending', 'success', 'failed');

CREATE TABLE marketplace_orders (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	store marketplace_store NOT NULL,
	kind account_purchase_kind NOT NULL,
	product_id INTEGER NOT NULL,
	status marketplace_order_status NOT NULL DEFAULT 'pending',
	idempotence_id TEXT NOT NULL UNIQUE,
	external_order_id TEXT,
	steam_account_id BIGINT REFERENCES steam_accounts (id) ON DELETE SET NULL,
	test_on_match_id BIGINT,
	error_message TEXT,
	test_result JSONB,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	completed_at TIMESTAMPTZ
);

CREATE INDEX marketplace_orders_store_status_idx
	ON marketplace_orders (store, status);

-- migrate:down
DROP TABLE IF EXISTS marketplace_orders;
DROP TYPE IF EXISTS marketplace_order_status;
DROP TYPE IF EXISTS account_purchase_kind;
DROP TYPE IF EXISTS marketplace_store;
