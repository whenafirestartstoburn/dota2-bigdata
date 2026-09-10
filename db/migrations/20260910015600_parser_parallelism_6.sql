-- migrate:up

UPDATE settings
SET
	value = '6',
	description = 'How many stored replays the Go parser parses at once.'
WHERE key = 'parser_parallelism';

-- migrate:down

UPDATE settings
SET
	value = '5',
	description = 'How many stored replays the Go parser parses at once.'
WHERE key = 'parser_parallelism';
