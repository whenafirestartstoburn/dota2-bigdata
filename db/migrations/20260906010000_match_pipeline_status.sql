-- migrate:up transaction:false

ALTER TYPE match_phase ADD VALUE IF NOT EXISTS 'awaiting_history';
ALTER TYPE match_phase ADD VALUE IF NOT EXISTS 'parsed';

-- migrate:down

-- Enum values cannot be dropped. Rows using them are remapped by the
-- following migration's down before this file is rolled back.
SELECT 1;
