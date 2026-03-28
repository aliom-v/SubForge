CREATE TABLE IF NOT EXISTS remote_subscription_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_sync_status TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_subscription_sources_source_url
  ON remote_subscription_sources(source_url);

CREATE INDEX IF NOT EXISTS idx_remote_subscription_sources_enabled
  ON remote_subscription_sources(enabled);
