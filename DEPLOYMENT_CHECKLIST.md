# Vercel + Neon deployment checklist (no Docker)

## Before deploying
- [ ] Create a Neon project and copy the pooled PostgreSQL connection string.
- [ ] Choose a stable `SENTINEL_WORKSPACE_ID`, or accept the `default` shared workspace.
- [ ] Configure `OPENAI_API_KEY` for the native OpenAI Decisions API. Sentinel fixes the decision model to `gpt-6-luna`.
- [ ] Create least-privilege GitHub/Jira credentials and/or a Google Drive read-only service account if those connectors are needed.

## Vercel setup
- [ ] Push this folder to a GitHub repository.
- [ ] Import it into Vercel as a Next.js project. Build command: `npm run build`; output settings: defaults.
- [ ] Set `DATABASE_URL` and, if needed, `SENTINEL_WORKSPACE_ID`.
- [ ] Add `OPENAI_API_KEY` and optional `DECISION_MIN_CONFIDENCE` to Vercel environment variables. Add optional connector variables from `.env.example` only when the integration is configured.
- [ ] Redeploy after environment variables change.

## Smoke test
- [ ] Create a risk assessment and refresh the page; verify it persists.
- [ ] Create a test assessment with evidence; verify the output reports `provider: "openai-decisions"`, model `gpt-6-luna`, and visible Predicate, Choice, and Score results.
- [ ] Configure GitHub/Jira/Drive credentials and click **Sync configured sources**.
- [ ] Check `GET /api/audit` to inspect the recent audit events.

## Safety
Do not expose this deployment publicly or use real payroll/HR data without adding an appropriate access layer and approving the data scope, retention, roles, and connector permissions.
