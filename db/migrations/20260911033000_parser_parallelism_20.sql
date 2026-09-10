-- migrate:up

UPDATE settings
SET
	value = '20',
	description = 'How many stored replays the Go parser parses at once. Needs the parser cgroup at ~3 CPU / 8 GiB; 20-wide on the old 0.90 / 4 GiB cap only thrashed CFS.'
WHERE key = 'parser_parallelism';

-- migrate:down

UPDATE settings
SET
	value = '6',
	description = 'How many stored replays the Go parser parses at once.'
WHERE key = 'parser_parallelism';
