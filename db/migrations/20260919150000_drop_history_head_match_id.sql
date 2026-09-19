-- Walker newest-page watermark. Unused: GetMatchHistory is newest
-- when history_checked_at is due, older pages use history_tail_match_id.

-- migrate:up

ALTER TABLE leagues DROP COLUMN history_head_match_id;

-- migrate:down

ALTER TABLE leagues ADD COLUMN history_head_match_id BIGINT;
