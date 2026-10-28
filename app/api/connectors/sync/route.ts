import { NextResponse } from "next/server";
import { createSign } from "node:crypto";
import { recordConnectorSync } from "@/lib/db";
import { getWorkspaceId } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 30;

type ConnectorRequest = {
  connector?: unknown;
  config?: Record<string, unknown>;
};

function clean(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseGitHubRepository(value: string) {
  let repository = value.trim().replace(/\.git$/i, "");
  if (/^https?:\/\//i.test(repository)) {
    const url = new URL(repository);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") throw new Error("Use an HTTPS github.com repository URL.");
    repository = url.pathname.replace(/^\/+|\/+$/g, "");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Repository must be https://github.com/owner/repository or owner/repository.");
  return repository;
}

function parseJiraBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.toLowerCase().endsWith(".atlassian.net")) throw new Error("Use an HTTPS Jira Cloud URL ending in .atlassian.net.");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

export async function POST(request: Request) {
  let body: ConnectorRequest = {};
  if (request.headers.get("content-type")?.includes("application/json")) {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 20_000) return NextResponse.json({ error: "Connector configuration is too large" }, { status: 413 });
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  }
  const requested = clean(body.connector, 40);
  const config = body.config ?? {};
  if (requested && !["GitHub", "Jira", "Google Drive"].includes(requested)) return NextResponse.json({ error: "Unsupported connector" }, { status: 400 });
  const shouldSync = (name: string) => !requested || requested === name;
  const sources: any[] = [];
  const errors: string[] = [];

  if (shouldSync("GitHub")) {
    const token = clean(config.token, 5000) || process.env.GITHUB_TOKEN || "";
    const repositoryInput = clean(config.repository, 1000) || process.env.GITHUB_REPO || "";
    if (token && repositoryInput) {
      try {
        const repository = parseGitHubRepository(repositoryInput);
        const response = await fetch(`https://api.github.com/repos/${repository}/pulls?state=open&per_page=30`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "GitHub rejected the token or repository permissions." : response.status === 404 ? "Repository not found or token cannot access it." : `GitHub returned ${response.status}.`);
        const pullRequests: any[] = await response.json();
        const stale = pullRequests.filter((pullRequest) => Date.now() - Date.parse(pullRequest.updated_at) > 48 * 60 * 60 * 1000);
        sources.push({ name: "GitHub", connected: true, count: pullRequests.length, repository, signal: pullRequests.length ? `${pullRequests.length} open pull requests; ${stale.length} have not been updated in over 48 hours.` : "No open pull requests found.", items: pullRequests.slice(0, 20).map((pullRequest) => ({ title: pullRequest.title, url: pullRequest.html_url, updatedAt: pullRequest.updated_at, draft: pullRequest.draft })) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "sync failed";
        errors.push(`GitHub: ${message}`);
        sources.push({ name: "GitHub", connected: false, count: 0, error: message });
      }
    } else sources.push({ name: "GitHub", connected: false, count: 0, setup: "Enter a GitHub repository URL and fine-grained access token, or configure GITHUB_TOKEN and GITHUB_REPO on the server." });
  }

  if (shouldSync("Google Drive")) {
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
        const tokenResponse = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!tokenResponse.ok) throw new Error(`Google token exchange returned ${tokenResponse.status}`);
        const tokenData: any = await tokenResponse.json();
        const query = `'${String(process.env.GOOGLE_DRIVE_FOLDER_ID).replace(/'/g, "\\'")}' in parents and trashed = false`;
        const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=50&orderBy=modifiedTime%20desc&fields=${encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink,description)")}`, { headers: { Authorization: `Bearer ${tokenData.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!driveResponse.ok) throw new Error(`Google Drive returned ${driveResponse.status}`);
        const data: any = await driveResponse.json(); const files = data.files ?? [];
        sources.push({ name: "Google Drive", connected: true, count: files.length, signal: `${files.length} documents listed from the configured shared folder.`, items: files.map((file: any) => ({ id: file.id, title: file.name, mimeType: file.mimeType, modifiedAt: file.modifiedTime, url: file.webViewLink, description: file.description })) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "sync failed";
        errors.push(`Google Drive: ${message}`);
        sources.push({ name: "Google Drive", connected: false, count: 0, error: message });
      }
    } else sources.push({ name: "Google Drive", connected: false, count: 0, setup: "Set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_FOLDER_ID; share the Drive folder with the service account email." });
  }

  if (shouldSync("Jira")) {
    const baseInput = clean(config.baseUrl, 1000) || process.env.JIRA_BASE_URL || "";
    const email = clean(config.email, 320) || process.env.JIRA_EMAIL || "";
    const token = clean(config.token, 5000) || process.env.JIRA_API_TOKEN || "";
    const jql = clean(config.jql, 2000) || process.env.JIRA_JQL || "statusCategory != Done ORDER BY priority DESC, updated ASC";
    if (baseInput && email && token) {
      try {
        const base = parseJiraBaseUrl(baseInput);
        const authorization = Buffer.from(`${email}:${token}`).toString("base64");
        const response = await fetch(`${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=30&fields=summary,status,priority,assignee,updated,duedate`, { headers: { Authorization: `Basic ${authorization}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Jira rejected the email, API token, or project permissions." : `Jira returned ${response.status}.`);
        const data: any = await response.json(); const issues = data.issues ?? [];
        sources.push({ name: "Jira", connected: true, count: issues.length, site: base, signal: `${issues.length} unresolved Jira issues returned by the configured JQL.`, items: issues.map((issue: any) => ({ key: issue.key, title: issue.fields?.summary, status: issue.fields?.status?.name, priority: issue.fields?.priority?.name, updatedAt: issue.fields?.updated, dueDate: issue.fields?.duedate, assignee: issue.fields?.assignee?.displayName })) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "sync failed";
        errors.push(`Jira: ${message}`);
        sources.push({ name: "Jira", connected: false, count: 0, error: message });
      }
    } else sources.push({ name: "Jira", connected: false, count: 0, setup: "Enter the Jira Cloud URL, email, and API token, or configure JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN on the server." });
  }

  try { await recordConnectorSync(getWorkspaceId(), sources, errors); }
  catch (error) { errors.push(`Database: ${error instanceof Error ? error.message : "could not record sync history"}`); }
  return NextResponse.json({ ok: true, sources, errors, note: "Credentials supplied in this request were used once and were not persisted." });
}
