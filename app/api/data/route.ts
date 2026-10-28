import { NextResponse } from "next/server";
import { ensureSchema, getSql } from "@/lib/db";
import { getWorkspaceId } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const workspaceId = getWorkspaceId();
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT state, updated_at FROM sentinel_workspace_state WHERE user_email = ${workspaceId} LIMIT 1`;
    return NextResponse.json({ state: rows[0]?.state ?? null, updatedAt: rows[0]?.updated_at ?? null });
  } catch (error) {
    console.error("Sentinel data read failed", error);
    return NextResponse.json({ error: "Database unavailable. Check DATABASE_URL and Neon network access." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const workspaceId = getWorkspaceId();
  let state: unknown;
  try { state = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!state || typeof state !== "object" || !Array.isArray((state as any).risks) || !Array.isArray((state as any).connectors) || !Array.isArray((state as any).profiles)) {
    return NextResponse.json({ error: "Expected risks, connectors and profiles arrays" }, { status: 400 });
  }
  if (JSON.stringify(state).length > 1_000_000) return NextResponse.json({ error: "Workspace payload is too large" }, { status: 413 });
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`INSERT INTO sentinel_workspace_state (user_email, state, updated_at) VALUES (${workspaceId}, ${JSON.stringify(state)}::jsonb, NOW()) ON CONFLICT (user_email) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`;
    await sql`INSERT INTO sentinel_audit_events (user_email, event_type, summary) SELECT ${workspaceId}, 'workspace_saved', 'Workspace data saved' WHERE NOT EXISTS (SELECT 1 FROM sentinel_audit_events WHERE user_email = ${workspaceId} AND event_type = 'workspace_saved' AND created_at > NOW() - INTERVAL '10 minutes')`;
    return NextResponse.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Sentinel data write failed", error);
    return NextResponse.json({ error: "Could not save workspace to Neon. Check DATABASE_URL and database permissions." }, { status: 503 });
  }
}
