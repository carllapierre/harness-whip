CREATE TABLE IF NOT EXISTS recoveries (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    failed_turn_id TEXT NOT NULL,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('waiting','dispatching','confirmed','canceled','attention')),
    due_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reason TEXT NOT NULL,
    confirmation TEXT,
    UNIQUE(thread_id, failed_turn_id)
);
CREATE INDEX IF NOT EXISTS recovery_due ON recoveries(status, due_at);
CREATE TABLE IF NOT EXISTS observed_threads (thread_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exclusions (thread_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    thread_id TEXT,
    recovery_id TEXT
);
CREATE TABLE IF NOT EXISTS watcher_lease (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
PRAGMA user_version = 1;
