CREATE TABLE IF NOT EXISTS monitoring_issues (
    key TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    observed_at INTEGER NOT NULL
);
PRAGMA user_version = 2;
