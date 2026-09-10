-- migrate:up

UPDATE settings
SET
	value = '8',
	description = 'How many stored replays the Go parser parses at once. 8-wide on 3 CPU / 8 GiB; 20-wide only raised wall time on this 4-core host.'
WHERE key = 'parser_parallelism';

-- migrate:down

UPDATE settings
SET
	value = '20',
	description = 'How many stored replays the Go parser parses at once.'
WHERE key = 'parser_parallelism';
