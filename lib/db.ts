import { neon } from "@neondatabase/serverless";

export type WorkspaceState = { risks: any[]; connectors: any[]; profiles: any[] };

let schemaReady: Promise<void> | null = null;

export function getSql() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

async function createSchema() {
  const sql = getSql();
  await sql`CREATE TABLE IF NOT EXISTS sentinel_workspace_state (user_email TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Sentinel workspace', state_initialized BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_risks (workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE, id TEXT NOT NULL, title TEXT NOT NULL, team TEXT NOT NULL, level TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, source TEXT NOT NULL, time_label TEXT NOT NULL, owner TEXT NOT NULL, evidence TEXT NOT NULL, recommendation TEXT NOT NULL, decision_output JSONB, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (workspace_id, id))`;
  await sql`ALTER TABLE sentinel_risks ADD COLUMN IF NOT EXISTS decision_output JSONB`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_connectors (workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, team TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, last_sync TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (workspace_id, name))`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_decision_profiles (workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL, team TEXT NOT NULL, description TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT FALSE, predicate TEXT NOT NULL, choices TEXT NOT NULL, scores TEXT NOT NULL, fields TEXT NOT NULL, approval TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (workspace_id, id))`;
  await sql`ALTER TABLE sentinel_decision_profiles ADD COLUMN IF NOT EXISTS sources TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_audit_events (id BIGSERIAL PRIMARY KEY, workspace_id TEXT, user_email TEXT, event_type TEXT NOT NULL, summary TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE sentinel_audit_events ADD COLUMN IF NOT EXISTS workspace_id TEXT`;
  await sql`ALTER TABLE sentinel_audit_events ADD COLUMN IF NOT EXISTS user_email TEXT`;
  await sql`UPDATE sentinel_audit_events SET workspace_id = COALESCE(workspace_id, user_email, 'default') WHERE workspace_id IS NULL`;
  await sql`ALTER TABLE sentinel_audit_events ALTER COLUMN workspace_id SET NOT NULL`;
  await sql`ALTER TABLE sentinel_audit_events ALTER COLUMN user_email DROP NOT NULL`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_ingested_events (id BIGSERIAL PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE, source TEXT NOT NULL, payload JSONB NOT NULL, processing_status TEXT NOT NULL DEFAULT 'received', received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_connector_syncs (id BIGSERIAL PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE, connector_name TEXT NOT NULL, connected BOOLEAN NOT NULL, record_count INTEGER NOT NULL DEFAULT 0, error TEXT, synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS sentinel_decision_runs (id BIGSERIAL PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES sentinel_workspaces(id) ON DELETE CASCADE, risk_title TEXT NOT NULL, provider TEXT, model TEXT, fallback_used BOOLEAN NOT NULL DEFAULT FALSE, outcome JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_risks_workspace_status_idx ON sentinel_risks (workspace_id, status, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_connectors_workspace_idx ON sentinel_connectors (workspace_id, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_profiles_workspace_idx ON sentinel_decision_profiles (workspace_id, is_active, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_audit_workspace_created_idx ON sentinel_audit_events (workspace_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_ingested_workspace_received_idx ON sentinel_ingested_events (workspace_id, received_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_syncs_workspace_synced_idx ON sentinel_connector_syncs (workspace_id, synced_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sentinel_decisions_workspace_created_idx ON sentinel_decision_runs (workspace_id, created_at DESC)`;
}

export function ensureSchema() {
  if (!schemaReady) schemaReady = createSchema().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

async function ensureWorkspace(workspaceId: string) {
  const sql = getSql();
  const name = process.env.SENTINEL_WORKSPACE_NAME?.trim() || "Sentinel workspace";
  await sql`INSERT INTO sentinel_workspaces (id, name) VALUES (${workspaceId}, ${name}) ON CONFLICT (id) DO NOTHING`;
}

function uniqueBy(items: any[], key: string) {
  const unique = new Map<string, any>();
  for (const item of items) {
    const value = String(item?.[key] ?? "").trim();
    if (value) unique.set(value, item);
  }
  return [...unique.values()];
}

function normalizeDecisionRationale(decision: any) {
  if (!decision || decision.status !== "success") return decision;
  const likelihood = typeof decision.riskProbability === "number" ? `${Math.round(decision.riskProbability * 100)}% probability of material risk` : "Probability was not returned";
  return {
    ...decision,
    rationale: [
      `Risk likelihood: ${likelihood}`,
      `Classification: ${decision.riskType || "No category was returned"}`,
      `Severity: ${decision.severity || "No severity was returned"}`,
      `Review requirement: ${decision.humanApprovalRequired ? "Human review is required before action" : "Eligible for the configured automated policy"}`,
    ].join("\n"),
  };
}

export async function saveWorkspaceState(workspaceId: string, state: WorkspaceState, recordAudit = true) {
  await ensureSchema();
  await ensureWorkspace(workspaceId);
  const sql = getSql();
  const risks = uniqueBy(state.risks, "id");
  const connectors = uniqueBy(state.connectors, "name");
  const profiles = uniqueBy(state.profiles, "id");
  const riskJson = JSON.stringify(risks);
  const connectorJson = JSON.stringify(connectors);
  const profileJson = JSON.stringify(profiles);
  const stateJson = JSON.stringify({ risks, connectors, profiles });

  await sql`INSERT INTO sentinel_risks (workspace_id, id, title, team, level, status, detail, source, time_label, owner, evidence, recommendation, decision_output, sort_order)
    SELECT ${workspaceId}, item->>'id', COALESCE(item->>'title',''), COALESCE(item->>'team',''), COALESCE(item->>'level','Low'), COALESCE(item->>'status','Needs review'), COALESCE(item->>'detail',''), COALESCE(item->>'source',''), COALESCE(item->>'time',''), COALESCE(item->>'owner',''), COALESCE(item->>'evidence',''), COALESCE(item->>'recommendation',''), item->'decision', position::INTEGER
    FROM jsonb_array_elements(${riskJson}::jsonb) WITH ORDINALITY AS entries(item, position)
    ON CONFLICT (workspace_id, id) DO UPDATE SET title=EXCLUDED.title, team=EXCLUDED.team, level=EXCLUDED.level, status=EXCLUDED.status, detail=EXCLUDED.detail, source=EXCLUDED.source, time_label=EXCLUDED.time_label, owner=EXCLUDED.owner, evidence=EXCLUDED.evidence, recommendation=EXCLUDED.recommendation, decision_output=EXCLUDED.decision_output, sort_order=EXCLUDED.sort_order, updated_at=NOW()`;
  await sql`DELETE FROM sentinel_risks WHERE workspace_id=${workspaceId} AND id NOT IN (SELECT value #>> '{}' FROM jsonb_array_elements(${JSON.stringify(risks.map((item) => String(item.id)))}::jsonb))`;

  await sql`INSERT INTO sentinel_connectors (workspace_id, name, team, description, status, last_sync, sort_order)
    SELECT ${workspaceId}, item->>'name', COALESCE(item->>'team',''), COALESCE(item->>'description',''), COALESCE(item->>'status','Not connected'), COALESCE(item->>'lastSync',''), position::INTEGER
    FROM jsonb_array_elements(${connectorJson}::jsonb) WITH ORDINALITY AS entries(item, position)
    ON CONFLICT (workspace_id, name) DO UPDATE SET team=EXCLUDED.team, description=EXCLUDED.description, status=EXCLUDED.status, last_sync=EXCLUDED.last_sync, sort_order=EXCLUDED.sort_order, updated_at=NOW()`;
  await sql`DELETE FROM sentinel_connectors WHERE workspace_id=${workspaceId} AND name NOT IN (SELECT value #>> '{}' FROM jsonb_array_elements(${JSON.stringify(connectors.map((item) => String(item.name)))}::jsonb))`;

  await sql`INSERT INTO sentinel_decision_profiles (workspace_id, id, name, team, description, is_active, predicate, choices, scores, fields, approval, sources, sort_order)
    SELECT ${workspaceId}, item->>'id', COALESCE(item->>'name',''), COALESCE(item->>'team',''), COALESCE(item->>'description',''), COALESCE((item->>'active')::BOOLEAN,FALSE), COALESCE(item->>'predicate',''), COALESCE(item->>'choices',''), COALESCE(item->>'scores',''), COALESCE(item->>'fields',''), COALESCE(item->>'approval',''), COALESCE(item->>'sources',''), position::INTEGER
    FROM jsonb_array_elements(${profileJson}::jsonb) WITH ORDINALITY AS entries(item, position)
    ON CONFLICT (workspace_id, id) DO UPDATE SET name=EXCLUDED.name, team=EXCLUDED.team, description=EXCLUDED.description, is_active=EXCLUDED.is_active, predicate=EXCLUDED.predicate, choices=EXCLUDED.choices, scores=EXCLUDED.scores, fields=EXCLUDED.fields, approval=EXCLUDED.approval, sources=EXCLUDED.sources, sort_order=EXCLUDED.sort_order, updated_at=NOW()`;
  await sql`DELETE FROM sentinel_decision_profiles WHERE workspace_id=${workspaceId} AND id NOT IN (SELECT value #>> '{}' FROM jsonb_array_elements(${JSON.stringify(profiles.map((item) => String(item.id)))}::jsonb))`;

  await sql`UPDATE sentinel_workspaces SET state_initialized=TRUE, updated_at=NOW() WHERE id=${workspaceId}`;
  if (recordAudit) await sql`INSERT INTO sentinel_audit_events (workspace_id, event_type, summary) SELECT ${workspaceId}, 'workspace_saved', 'Workspace data saved' WHERE NOT EXISTS (SELECT 1 FROM sentinel_audit_events WHERE workspace_id=${workspaceId} AND event_type='workspace_saved' AND created_at > NOW() - INTERVAL '10 minutes')`;
  await sql`INSERT INTO sentinel_workspace_state (user_email, state, updated_at) VALUES (${workspaceId}, ${stateJson}::jsonb, NOW())
    ON CONFLICT (user_email) DO UPDATE SET state=EXCLUDED.state, updated_at=NOW()`;
}

export async function loadWorkspaceState(workspaceId: string): Promise<WorkspaceState | null> {
  await ensureSchema();
  await ensureWorkspace(workspaceId);
  const sql = getSql();
  const workspace = await sql`SELECT state_initialized, updated_at FROM sentinel_workspaces WHERE id=${workspaceId} LIMIT 1`;
  const snapshotRows = await sql`SELECT state, updated_at FROM sentinel_workspace_state WHERE user_email=${workspaceId} LIMIT 1`;
  const snapshot = snapshotRows[0]?.state as WorkspaceState | undefined;
  const snapshotIsCurrent = snapshotRows[0]?.updated_at && workspace[0]?.updated_at
    ? new Date(snapshotRows[0].updated_at).getTime() >= new Date(workspace[0].updated_at).getTime()
    : Boolean(snapshotRows[0]?.updated_at);
  if (snapshotIsCurrent && snapshot && Array.isArray(snapshot.risks) && Array.isArray(snapshot.connectors) && Array.isArray(snapshot.profiles)) {
    return { ...snapshot, risks: snapshot.risks.map((risk: any) => ({ ...risk, decision: normalizeDecisionRationale(risk.decision) })) };
  }
  if (!workspace[0]?.state_initialized) {
    const state = snapshot;
    if (state && Array.isArray(state.risks) && Array.isArray(state.connectors) && Array.isArray(state.profiles)) {
      await saveWorkspaceState(workspaceId, state, false);
      await sql`INSERT INTO sentinel_audit_events (workspace_id, event_type, summary) VALUES (${workspaceId}, 'workspace_migrated', 'Legacy JSONB workspace migrated to normalized tables')`;
      return state;
    }
    return null;
  }
  const [risks, connectors, profiles] = await Promise.all([
    sql`SELECT risk.id, risk.title, risk.team, risk.level, risk.status, risk.detail, risk.source, risk.time_label AS time, risk.owner, risk.evidence, risk.recommendation,
      COALESCE(risk.decision_output, CASE WHEN run.outcome IS NOT NULL THEN jsonb_build_object('status','success','profileName',run.outcome->'profileUsed'->>'name','provider',run.provider,'model',run.model,'fallbackUsed',run.fallback_used,'riskDetected',run.outcome->'assessment'->'riskDetected','riskProbability',run.outcome->'assessment'->'riskProbability','riskType',run.outcome->'assessment'->>'riskType','severity',run.outcome->'assessment'->>'severity','confidence',run.outcome->'assessment'->'confidence','policy',run.outcome->'assessment'->>'policy','humanApprovalRequired',run.outcome->'assessment'->'humanApprovalRequired','rationale',run.outcome->'assessment'->>'rationale','recommendedActions',run.outcome->'assessment'->'recommendedActions') WHEN run.error IS NOT NULL THEN jsonb_build_object('status','failed','error',run.error) ELSE NULL END) AS decision
      FROM sentinel_risks risk LEFT JOIN LATERAL (SELECT outcome, error, provider, model, fallback_used FROM sentinel_decision_runs WHERE workspace_id=${workspaceId} AND risk_title=risk.title ORDER BY created_at DESC LIMIT 1) run ON TRUE WHERE risk.workspace_id=${workspaceId} ORDER BY risk.sort_order, risk.created_at`,
    sql`SELECT name, team, description, status, last_sync AS "lastSync" FROM sentinel_connectors WHERE workspace_id=${workspaceId} ORDER BY sort_order, created_at`,
    sql`SELECT id, name, team, description, is_active AS active, predicate, choices, scores, fields, approval, sources FROM sentinel_decision_profiles WHERE workspace_id=${workspaceId} ORDER BY sort_order, created_at`,
  ]);
  return { risks: [...risks].map((risk: any) => ({ ...risk, decision: normalizeDecisionRationale(risk.decision) })), connectors: [...connectors], profiles: [...profiles] };
}

export async function recordConnectorSync(workspaceId: string, sources: any[], errors: string[]) {
  await ensureSchema();
  await ensureWorkspace(workspaceId);
  const sql = getSql();
  for (const source of sources) {
    const error = errors.find((message) => message.startsWith(`${source.name}:`)) ?? null;
    await sql`INSERT INTO sentinel_connector_syncs (workspace_id, connector_name, connected, record_count, error) VALUES (${workspaceId}, ${String(source.name)}, ${Boolean(source.connected)}, ${Number(source.count || 0)}, ${error})`;
  }
  await sql`INSERT INTO sentinel_audit_events (workspace_id, event_type, summary) VALUES (${workspaceId}, 'connectors_synced', ${`${sources.length} connector(s) checked; ${errors.length} error(s)`})`;
}

export async function recordDecisionRun(workspaceId: string, title: string, result: any, error: string | null = null) {
  await ensureSchema();
  await ensureWorkspace(workspaceId);
  const sql = getSql();
  const outcome = result ? JSON.stringify(result) : null;
  await sql`INSERT INTO sentinel_decision_runs (workspace_id, risk_title, provider, model, fallback_used, outcome, error) VALUES (${workspaceId}, ${title}, ${result?.provider ?? null}, ${result?.model ?? null}, ${Boolean(result?.fallbackUsed)}, ${outcome}::jsonb, ${error})`;
}
