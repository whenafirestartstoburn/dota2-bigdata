-- migrate:up

UPDATE settings
SET
	value = '5',
	description = 'Max queued historical fetch_match_details jobs. Parallelism is 5 details queues.'
WHERE key = 'history_details_enqueue_limit';

-- migrate:down

UPDATE settings
SET
	value = '500',
	description = 'Max in-flight historical fetch_match_details jobs.'
WHERE key = 'history_details_enqueue_limit';
