# Decision providers: Jev primary, GPT-6 Luna fallback

Sentinel uses **Jev through Vercel AI Gateway** first, then falls back to **GPT-6 Luna through OpenAI's native Decisions API** if Jev is unavailable, times out, or returns an invalid response.

## Environment variables

```env
# Vercel AI Gateway key (not a TypeSafe API key)
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
JEV_PRIMARY_ENABLED=true
JEV_MIN_CONFIDENCE=0.65

# Direct OpenAI API key for GPT-6 Luna fallback
OPENAI_API_KEY=your_openai_api_key
OPENAI_FALLBACK_MODEL=gpt-6-luna
```

If your key variable is currently named `VERCEL_GATEWAY_KEY`, copy its value into `AI_GATEWAY_API_KEY` or rename the variable consistently in Vercel and `.env.local`. Do not put keys in client-side code or commit `.env.local`.

## How it works

1. `POST /api/decisions` accepts requests from the shared Sentinel workspace.
2. It calls Jev with model ID `typesafe-ai/jev` through Vercel AI Gateway using AI SDK's `experimental_evaluate` API.
3. If Jev fails, it calls `https://api.openai.com/v1/decisions` with model `gpt-6-luna` and the same predicate/choice/score questions.
4. Sentinel applies deterministic review rules: High/Critical severity, confidence below `JEV_MIN_CONFIDENCE`, or missing evidence require human review.
5. Response metadata includes `provider` and `fallbackUsed`.

Jev uses Vercel AI Gateway billing; Luna fallback uses your direct OpenAI API billing. The gateway key is not a TypeSafe key. Jev's Gateway model ID is `typesafe-ai/jev`; Luna's direct OpenAI Decisions model is `gpt-6-luna`.

## Test request

Call `POST /api/decisions` from the application:

```json
{
  "state": {
    "title": "Release readiness risk",
    "detail": "Three critical bugs remain open and the release engineer is unavailable.",
    "evidence": "Issue tracker shows three unresolved critical bugs; release is scheduled in two weeks."
  },
  "profile": {
    "predicate": "Does this require human review?",
    "choiceOptions": ["Delivery delay", "Quality issue", "Resource dependency", "No material risk"],
    "scoreLevels": ["Low", "Medium", "High", "Critical"]
  }
}
```

The route has no application-level authentication. Do not expose it publicly without an external access layer.

## Reliability and safety

- A fallback is attempted for runtime errors; it does not guarantee the two providers will agree.
- If both providers fail, the endpoint returns HTTP 503 and preserves provider diagnostics without exposing credentials.
- Model decisions are advisory. Do not allow model output alone to authorize payments, access changes, or other sensitive actions.
- Calibrate confidence thresholds against reviewed Sentinel cases before production use.
