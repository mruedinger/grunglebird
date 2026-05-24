CREATE TABLE credentials (
  credential_id TEXT PRIMARY KEY,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  label TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
