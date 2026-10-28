# Sentinel — Organization Risk Intelligence

Next.js 14 + TypeScript + Tailwind application for organization risk monitoring. This version is prepared for **Vercel + Neon PostgreSQL**, without Docker.

## Run locally

Requirements: Node.js 20 LTS recommended.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. No sign-in is required.

## Required environment variables

- `DATABASE_URL`: Neon pooled PostgreSQL connection string.
- `SENTINEL_WORKSPACE_ID`: optional stable key for the shared workspace; defaults to `default`. To keep data previously stored under a Google account, set this to that account's lowercase email address.

Optional variables are documented in `.env.example`: Jev, GitHub, Jira, Google Drive and event ingestion.

## Vercel + Neon deployment

1. Create a Neon project at https://console.neon.tech and copy its pooled connection string.
2. Push this project to a GitHub repository. Do not commit `.env.local`.
3. Import the repository in https://vercel.com and use the default Next.js build settings. No Dockerfile is needed.
4. Add the environment variables from `.env.example` in Vercel Project → Settings → Environment Variables. Add production and preview values deliberately; do not reuse production secrets in untrusted preview deployments.
5. Redeploy after changing environment variables.
6. Create a risk assessment, refresh, and verify that the risk persists. The API creates the database tables on first request; `db/schema.sql` is also provided.

## Implemented in this starter

- Shared workspace data stored in Neon JSONB; audit events stored in PostgreSQL.
- Jev-first decision endpoint: calls Jev System One for Predicate (`noul`), Choice and Score decisions; if Jev is missing, unavailable, rate-limited, or returns an invalid response, it falls back to the direct OpenAI API. Provider credentials stay server-side. Human review is required for High/Critical severity, low confidence, or missing evidence. Configure `AI_GATEWAY_API_KEY` and `OPENAI_API_KEY` in `.env.local` and Vercel.
- Live GitHub open pull-request, Jira unresolved-issue, and Google Drive shared-folder metadata ingestion when credentials are configured.
- Token-protected generic ingestion endpoint for HRIS/supplier/Slack/internal events.
- CSV export and responsive UI.

## Important integration boundaries

- You must supply provider credentials. No external account is pre-authorized by this ZIP.
- Google Drive uses a read-only service account shared with the configured folder; it syncs metadata only and is unrelated to application access.
- The generic ingestion endpoint records events in audit history; it does not automatically turn them into risk records yet. GitHub/Jira sync currently creates reviewable summary assessments from returned source counts.
- The application has no user authentication and exposes one shared workspace. Add an access layer before an internet-facing or multi-tenant production rollout, along with organization/workspace membership, roles, encrypted per-tenant connector secrets, retention controls, scheduled sync jobs, and stronger audit semantics.
- This is an integration-ready starter, not a claim of production security certification. Review the code and provider permissions before using real HR or payroll data.


## Jev primary + OpenAI fallback

The `POST /api/decisions` route tries Jev first when `JEV_PRIMARY_ENABLED=true` and `AI_GATEWAY_API_KEY` is set. On a Jev failure it tries GPT-6 Luna through the native OpenAI Decisions API using `OPENAI_API_KEY` and `OPENAI_FALLBACK_MODEL` (defaults to `gpt-6-luna`). The response includes `provider` and `fallbackUsed` so you can observe which provider completed the decision. It returns HTTP 503 only if neither provider can complete the request.

Required decision environment variables:

```env
AI_GATEWAY_API_KEY=your-jev-key
TYPESAFE_API_URL=https://api.typesafe.ai/v1/systemone
TYPESAFE_MODEL=jev-latest
JEV_PRIMARY_ENABLED=true
JEV_MIN_CONFIDENCE=0.65
OPENAI_API_KEY=your-openai-api-key
OPENAI_FALLBACK_MODEL=gpt-6-luna
```

Never commit real credentials. If a credential was pasted into chat, rotate it before deployment. `OPENAI_API_KEY` is sent only from the server to `https://api.openai.com/v1/chat/completions`; it is not sent to the browser.
