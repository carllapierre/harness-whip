-- Only the retired budget guard created this reason before any dispatch.
-- Preserve uncertain delivery, cancellations, confirmed turns and recorded sends.
UPDATE recoveries
SET status = 'waiting',
    reason = 'Conversation limit removed; awaiting quota and conversation recheck',
    due_at = 0,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE status = 'attention'
    AND reason = 'Per-conversation whip budget reached'
    AND confirmation IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM activity
        WHERE activity.recovery_id = recoveries.id AND activity.kind = 'send'
    );
PRAGMA user_version = 3;
