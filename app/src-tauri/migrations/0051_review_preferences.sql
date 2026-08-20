CREATE TABLE review_preferences (
  id TEXT PRIMARY KEY NOT NULL CHECK (id='default'),
  max_daily_minutes INTEGER NOT NULL DEFAULT 25 CHECK (max_daily_minutes BETWEEN 5 AND 180),
  max_modules INTEGER NOT NULL DEFAULT 2 CHECK (max_modules BETWEEN 1 AND 12),
  preferred_mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (preferred_mode IN ('quick', 'standard', 'mock_test')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO review_preferences(
  id,max_daily_minutes,max_modules,preferred_mode,created_at,updated_at
) VALUES('default',25,2,'standard',unixepoch('now') * 1000,unixepoch('now') * 1000);
