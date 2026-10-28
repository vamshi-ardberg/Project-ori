import { NextResponse } from "next/server";
import { loadWorkspaceState, saveWorkspaceState } from "@/lib/db";
import { getWorkspaceId } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const workspaceId = getWorkspaceId();
  try {
    const state = await loadWorkspaceState(workspaceId);
    return NextResponse.json({ state });
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
    const expected = state as { risks: any[]; connectors: any[]; profiles: any[] };
    await saveWorkspaceState(workspaceId, expected);
    const persisted = await loadWorkspaceState(workspaceId);
    const ids = (items: any[], key: string) => items.map((item) => String(item?.[key] ?? "")).filter(Boolean).sort().join("\n");
    const verified = Boolean(persisted)
      && ids(persisted!.risks, "id") === ids(expected.risks, "id")
      && ids(persisted!.connectors, "name") === ids(expected.connectors, "name")
      && ids(persisted!.profiles, "id") === ids(expected.profiles, "id");
    if (!verified) throw new Error("Workspace read-after-write verification failed");
    return NextResponse.json({ ok: true, verified: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Sentinel data write failed", error);
    return NextResponse.json({ error: "Could not save workspace to Neon. Check DATABASE_URL and database permissions." }, { status: 503 });
  }
}
