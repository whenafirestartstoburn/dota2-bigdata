-- migrate:up

ALTER TYPE match_phase ADD VALUE IF NOT EXISTS 'not_started';

-- migrate:down

-- Postgres cannot drop an enum value. Rows using not_started are moved off
-- it in 20260906104100's down before this file is reverted.
