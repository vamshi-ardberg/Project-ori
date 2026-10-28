import { neon } from "@neondatabase/serverless";

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export async function ensureSchema() {
  const sql = getSql();
  await sql`CREATE TABLE IF NOT EXISTS sentinel_workspace_state (user_email TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_audit_events (id BIGSERIAL PRIMARY KEY, user_email TEXT NOT NULL, event_type TEXT NOT NULL, summary TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_audit_user_created_idx ON sentinel_audit_events (user_email, created_at DESC)`;
}
