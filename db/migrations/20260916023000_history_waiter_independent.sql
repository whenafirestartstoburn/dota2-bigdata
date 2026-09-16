-- migrate:up transaction:false
DROP INDEX CONCURRENTLY IF EXISTS matches_history_poll_idx;
CREATE INDEX CONCURRENTLY matches_history_poll_idx
	ON matches (league_id, history_next_poll_at)
	WHERE history_next_poll_at IS NOT NULL AND match_seq_num IS NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS matches_history_poll_idx;
CREATE INDEX CONCURRENTLY matches_history_poll_idx
	ON matches (league_id, history_next_poll_at)
	WHERE status = 'awaiting_history';
