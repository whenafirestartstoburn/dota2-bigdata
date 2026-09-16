-- migrate:up

ALTER TABLE steam_api_requests
	ADD COLUMN steam_api_key_id bigint,
	ADD COLUMN steam_account_id bigint;

ALTER TABLE steam_gc_requests
	ADD COLUMN steam_api_key_id bigint,
	ADD COLUMN steam_account_id bigint;

CREATE INDEX steam_api_requests_key_idx
	ON steam_api_requests (steam_api_key_id);
CREATE INDEX steam_api_requests_account_idx
	ON steam_api_requests (steam_account_id);
CREATE INDEX steam_gc_requests_key_idx
	ON steam_gc_requests (steam_api_key_id);
CREATE INDEX steam_gc_requests_account_idx
	ON steam_gc_requests (steam_account_id);

-- migrate:down

DROP INDEX IF EXISTS steam_api_requests_key_idx;
DROP INDEX IF EXISTS steam_api_requests_account_idx;
DROP INDEX IF EXISTS steam_gc_requests_key_idx;
DROP INDEX IF EXISTS steam_gc_requests_account_idx;

ALTER TABLE steam_api_requests
	DROP COLUMN IF EXISTS steam_api_key_id,
	DROP COLUMN IF EXISTS steam_account_id;

ALTER TABLE steam_gc_requests
	DROP COLUMN IF EXISTS steam_api_key_id,
	DROP COLUMN IF EXISTS steam_account_id;
