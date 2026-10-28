import { NextResponse } from "next/server";
import { ensureSchema, getSql } from "@/lib/db";
import { getWorkspaceId } from "@/lib/workspace";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const expected = process.env.SENTINEL_INGEST_TOKEN; const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !provided || provided.length !== expected.length || !Buffer.from(provided).equals(Buffer.from(expected))) return NextResponse.json({ error: "Unauthorized ingestion request" }, { status: 401 });
  let body: any; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body?.source || !body?.event || typeof body.event !== "object") return NextResponse.json({ error: "Expected source and event object" }, { status: 400 });
  const owner = getWorkspaceId();
  try { await ensureSchema(); const sql = getSql(); await sql`INSERT INTO sentinel_workspaces (id, name) VALUES (${owner}, 'Sentinel workspace') ON CONFLICT (id) DO NOTHING`; await sql`INSERT INTO sentinel_ingested_events (workspace_id, source, payload) VALUES (${owner}, ${String(body.source).slice(0,60)}, ${JSON.stringify(body.event)}::jsonb)`; await sql`INSERT INTO sentinel_audit_events (workspace_id, event_type, summary) VALUES (${owner}, ${`ingest:${String(body.source).slice(0,60)}`}, ${JSON.stringify(body.event).slice(0,1000)})`; return NextResponse.json({ ok: true, accepted: true }, { status: 202 }); }
  catch { return NextResponse.json({ error: "Could not persist ingestion event" }, { status: 503 }); }
}
