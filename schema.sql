CREATE TABLE IF NOT EXISTS ai_quota (
  bucket TEXT PRIMARY KEY,
  used INTEGER NOT NULL CHECK(used > 0)
);
CREATE TABLE IF NOT EXISTS ledgers (
  owner TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision > 0),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
