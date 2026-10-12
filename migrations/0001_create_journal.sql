CREATE TABLE applications (
  record_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  revision TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX applications_updated_at_idx ON applications(updated_at DESC);

CREATE TABLE application_write_assertions (
  changed INTEGER NOT NULL CHECK (changed = 1)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
