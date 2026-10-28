-- Sentinel schema. API routes also create these tables automatically.
CREATE TABLE IF NOT EXISTS sentinel_workspace_state (
  user_email TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sentinel_audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sentinel_audit_user_created_idx ON sentinel_audit_events (user_email, created_at DESC);
