-- migrate:up

INSERT INTO settings (key, value, description) VALUES
	(
		'marketplace_settle_interval_ms',
		'60000',
		'How often settle_marketplace_orders polls pending Dark Shopping rows.'
	),
	(
		'marketplace_pending_ttl_ms',
		'3600000',
		'Fail a pending marketplace_orders row this long after created_at if Dark Shopping is still in_process.'
	);

-- migrate:down

DELETE FROM settings
WHERE key IN (
	'marketplace_settle_interval_ms',
	'marketplace_pending_ttl_ms'
);
