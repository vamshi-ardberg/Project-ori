# Sentinel connector setup

## Live pull connectors

### GitHub pull requests
1. Create a fine-grained GitHub personal access token restricted to the target repository. Grant read-only **Pull requests** and **Metadata** permissions.
2. Set `GITHUB_TOKEN` and `GITHUB_REPO=owner/repository` in `.env.local` and Vercel project environment variables.
3. Open Sentinel and use **Data connectors → Sync configured sources**. The sync endpoint fetches open pull requests and highlights items not updated in 48 hours.

### Jira Cloud issues
1. Create an Atlassian API token and use the Atlassian account email that owns it.
2. Set `JIRA_BASE_URL=https://your-domain.atlassian.net`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and optionally `JIRA_JQL`.
3. Use **Sync configured sources**. The sync endpoint reads unresolved issues and their priority, status, assignee and dates. Restrict the token to the minimum required access.

## Google Drive shared folder

1. In Google Cloud Console, enable the Google Drive API and create a service account with read-only access.
2. Share the specific Drive folder with the service account email address (Viewer access is sufficient).
3. Store the service account JSON credentials as a single-line JSON value in `GOOGLE_SERVICE_ACCOUNT_JSON` and the folder ID in `GOOGLE_DRIVE_FOLDER_ID`.
4. Use **Sync configured sources**. This lists document metadata only; it does not download or semantically analyze document contents. Keep service-account credentials server-side only.

## HRIS, supplier systems, Slack and internal feeds

A generic ingestion endpoint is available at `POST /api/ingest`. Set a long random `SENTINEL_INGEST_TOKEN` in Vercel. Send JSON with `Authorization: Bearer <token>` and body `{"source":"supplier-feed","event":{"supplier":"Example","status":"delayed","deliveryDate":"2026-11-03"}}`. Events are written to the shared workspace's audit stream. Do not send passwords, personal employee data, payroll data, or other sensitive details unless your organization has approved the data handling and retention design. This endpoint records incoming events; it does not yet parse them into risk assessments automatically.

## Credential handling

Never place provider tokens in frontend code, `NEXT_PUBLIC_*` variables, Git commits, or browser local storage. Put credentials in Vercel Project → Settings → Environment Variables and redeploy. For local development use `.env.local` (ignored by Git).
