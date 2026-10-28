# OpenAI Decisions provider: GPT-6 Luna

Sentinel calls OpenAI's native Decisions API directly with **GPT-6 Luna**. It does not use Vercel AI Gateway or a fallback provider.

## Environment variables

```env
OPENAI_API_KEY=your_openai_api_key
DECISION_MIN_CONFIDENCE=0.65
```

Keep the key server-side and never commit `.env.local`.

## Decision profile mapping

- **Predicate** returns whether a material risk is detected and its probability.
- **Choice** selects one of the profile's allowed risk types.
- **Score** assigns one ordered severity level, such as Low, Medium, High, or Critical.

The application also applies a deterministic approval rule: High/Critical severity, confidence below `DECISION_MIN_CONFIDENCE`, or missing evidence requires human review.

## Test request

```json
{
  "state": {
    "title": "Release readiness risk",
    "detail": "Three critical bugs remain open and the release engineer is unavailable.",
    "evidence": "Issue tracker shows three unresolved critical bugs; release is scheduled in two weeks."
  },
  "profile": {
    "name": "Release readiness",
    "predicate": "Is the release at risk?",
    "choices": "Release delay, Quality issue, Resource dependency, No material risk",
    "scores": "Low, Medium, High, Critical"
  }
}
```

Send it to `POST /api/decisions`. A successful result contains `riskDetected`, `riskProbability`, `riskType`, `severity`, `confidence`, `humanApprovalRequired`, `rationale`, and `recommendedActions`.

Model decisions are advisory. Do not allow the model output alone to authorize payments, access changes, or other sensitive actions.
