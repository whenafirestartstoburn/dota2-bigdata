-- migrate:up transaction:false
DROP INDEX CONCURRENTLY IF EXISTS matches_history_poll_idx;

-- migrate:down transaction:false
CREATE INDEX CONCURRENTLY matches_history_poll_idx
	ON matches (league_id, history_next_poll_at)
	WHERE status = 'awaiting_history';
