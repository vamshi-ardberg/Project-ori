import { NextResponse } from "next/server";
import { createSign } from "node:crypto";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const sources: any[] = []; const errors: string[] = [];
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
    try {
      const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/pulls?state=open&per_page=30`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`); const prs: any[] = await res.json();
      const stale = prs.filter(p => Date.now() - Date.parse(p.updated_at) > 48 * 60 * 60 * 1000);
      sources.push({ name: "GitHub", connected: true, count: prs.length, signal: prs.length ? `${prs.length} open pull requests; ${stale.length} have not been updated in over 48 hours.` : "No open pull requests found.", items: prs.slice(0, 20).map(p => ({ title: p.title, url: p.html_url, updatedAt: p.updated_at, draft: p.draft })) });
    } catch (e) { errors.push(`GitHub: ${e instanceof Error ? e.message : "sync failed"}`); }
  } else sources.push({ name: "GitHub", connected: false, setup: "Set GITHUB_TOKEN and GITHUB_REPO (owner/repository) in Vercel environment variables." });
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID) {
    try {
      const account = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const now = Math.floor(Date.now() / 1000);
      const b64 = (value: string) => Buffer.from(value).toString("base64url");
      const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claim = b64(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: account.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
      const unsigned = `${header}.${claim}`;
      const signer = createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
      const assertion = `${unsigned}.${signer.sign(account.private_key).toString("base64url")}`;
      const tokenRes = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), cache: "no-store" });
      if (!tokenRes.ok) throw new Error(`Google token exchange returned ${tokenRes.status}`);
      const tokenData: any = await tokenRes.json();
      const query = `'${String(process.env.GOOGLE_DRIVE_FOLDER_ID).replace(/'/g, "\\'")}' in parents and trashed = false`;
      const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=50&orderBy=modifiedTime%20desc&fields=${encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink,description)")}`, { headers: { Authorization: `Bearer ${tokenData.access_token}` }, cache: "no-store" });
      if (!driveRes.ok) throw new Error(`Google Drive returned ${driveRes.status}`);
      const data: any = await driveRes.json(); const files = data.files ?? [];
      sources.push({ name: "Google Drive", connected: true, count: files.length, signal: `${files.length} documents listed from the configured shared folder.`, items: files.map((f: any) => ({ id: f.id, title: f.name, mimeType: f.mimeType, modifiedAt: f.modifiedTime, url: f.webViewLink, description: f.description })) });
    } catch (e) { errors.push(`Google Drive: ${e instanceof Error ? e.message : "sync failed"}`); }
  } else sources.push({ name: "Google Drive", connected: false, setup: "Set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_FOLDER_ID; share the Drive folder with the service account email. See CONNECTORS.md." });
  if (process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    try {
      const base = process.env.JIRA_BASE_URL.replace(/\/$/, ""); const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
      const jql = process.env.JIRA_JQL || "statusCategory != Done ORDER BY priority DESC, updated ASC";
      const res = await fetch(`${base}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=30&fields=summary,status,priority,assignee,updated,duedate`, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`Jira returned ${res.status}`); const data: any = await res.json(); const issues = data.issues ?? [];
      sources.push({ name: "Jira", connected: true, count: issues.length, signal: `${issues.length} unresolved Jira issues returned by configured JQL.`, items: issues.map((i: any) => ({ key: i.key, title: i.fields?.summary, status: i.fields?.status?.name, priority: i.fields?.priority?.name, updatedAt: i.fields?.updated, dueDate: i.fields?.duedate, assignee: i.fields?.assignee?.displayName })) });
    } catch (e) { errors.push(`Jira: ${e instanceof Error ? e.message : "sync failed"}`); }
  } else sources.push({ name: "Jira", connected: false, setup: "Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in Vercel environment variables." });
  return NextResponse.json({ ok: true, sources, errors, note: "GitHub and Jira signals are fetched live. Other sources can post normalized events to the ingestion endpoint documented in CONNECTORS.md." }, { status: 200 });
}
