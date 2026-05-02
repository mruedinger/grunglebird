CREATE TABLE rate_limits (
  bucket_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX idx_rate_limits_window_start ON rate_limits(window_start);
