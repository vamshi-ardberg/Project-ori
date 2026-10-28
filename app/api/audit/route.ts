import { NextResponse } from "next/server";
import { ensureSchema, getSql } from "@/lib/db";
import { getWorkspaceId } from "@/lib/workspace";
export const runtime = "nodejs";
export async function GET() {
  const workspaceId = getWorkspaceId();
  try { await ensureSchema(); const sql = getSql(); const rows = await sql`SELECT event_type, summary, created_at FROM sentinel_audit_events WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 100`; return NextResponse.json({ events: rows }); }
  catch { return NextResponse.json({ error: "Audit history unavailable" }, { status: 503 }); }
}
