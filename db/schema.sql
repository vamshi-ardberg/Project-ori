-- Sentinel normalized schema. API routes apply the same additive migration automatically.
CREATE TABLE IF NOT EXISTS sentinel_workspace_state (
  user_email TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sentinel_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Sentinel workspace',
  state_initialized BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sentinel_risks (
  workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  team TEXT NOT NULL,
  level TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  source TEXT NOT NULL,
  time_label TEXT NOT NULL,
  owner TEXT NOT NULL,
  evidence TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  decision_output JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id)
);

ALTER TABLE sentinel_risks ADD COLUMN IF NOT EXISTS decision_output JSONB;

CREATE TABLE IF NOT EXISTS sentinel_connectors (
  workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  last_sync TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS sentinel_decision_profiles (
  workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  predicate TEXT NOT NULL,
  choices TEXT NOT NULL,
  scores TEXT NOT NULL,
  fields TEXT NOT NULL,
  approval TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id)
);

ALTER TABLE sentinel_decision_profiles ADD COLUMN IF NOT EXISTS sources TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS sentinel_audit_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT,
  user_email TEXT,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sentinel_audit_events ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE sentinel_audit_events ADD COLUMN IF NOT EXISTS user_email TEXT;
UPDATE sentinel_audit_events SET workspace_id = COALESCE(workspace_id, user_email, 'default') WHERE workspace_id IS NULL;
ALTER TABLE sentinel_audit_events ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE sentinel_audit_events ALTER COLUMN user_email DROP NOT NULL;

CREATE TABLE IF NOT EXISTS sentinel_ingested_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sentinel_connector_syncs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE,
  connector_name TEXT NOT NULL,
  connected BOOLEAN NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sentinel_decision_runs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE,
  risk_title TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  outcome JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sentinel_risks_workspace_status_idx ON sentinel_risks (workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_connectors_workspace_idx ON sentinel_connectors (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_profiles_workspace_idx ON sentinel_decision_profiles (workspace_id, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_audit_workspace_created_idx ON sentinel_audit_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_ingested_workspace_received_idx ON sentinel_ingested_events (workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_syncs_workspace_synced_idx ON sentinel_connector_syncs (workspace_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_decisions_workspace_created_idx ON sentinel_decision_runs (workspace_id, created_at DESC);
