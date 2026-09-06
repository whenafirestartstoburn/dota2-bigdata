-- migrate:up

UPDATE settings
SET
	value = '10',
	description = 'How many stored replays the Go parser parses at once.'
WHERE key = 'parser_parallelism';

-- migrate:down

UPDATE settings
SET
	value = '1',
	description = 'How many stored replays the Go parser parses at once.'
WHERE key = 'parser_parallelism';
