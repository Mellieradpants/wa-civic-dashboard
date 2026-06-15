# Washington Civic Dashboard

A civic dashboard that makes Washington State legislation readable in plain English. Search any of 2,808 active 2025–26 bills and read what each section actually requires in plain language.

---

## How the pipeline works

No AI in the data path. Everything is deterministic and traceable to source text. Missing information is flagged, not filled.

Input text runs through a 10-layer pipeline that detects section type, strips deleted text from amendments, extracts obligations, and renders plain sentences. A renderer turns those into output using one of six scope-lens templates.

The bill index is populated from the WA Legislature API by a GitHub Actions workflow that runs daily and can be triggered manually.

---

## Validation and known limitations

Output is validated against a 338-bill sample drawn from the 2,808-bill 2025–26 session corpus at 95% confidence with a ±5% margin of error (finite population correction applied).

A pass/fail rubric (C1–C7) defines machine-scoreable structural checks, applied to all 338 bills. Structural correctness claim is defensible.

**Known pipeline limitations (confirmed, not fixable without scoped pipeline changes):**

- `"May [date]"` — month "May" triggers modal substitution before the temporal parser can protect date context
- `"shall be construed"` — misidentifies as wrong modal frame

---

## Tech stack

- Node.js, Express 4
- Single Render service — Express serves both the API and the HTML pages
- Bill index populated from WA Legislature API via GitHub Actions — updates daily
- Upstash Redis — optional cache layer, degrades gracefully if absent
- No database — bill index and synonym map are static JSON files

---

## API endpoints

Full spec at `/api/openapi`.

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/wa-bill-search` | Keyword or bill-number search against local index |
| GET | `/api/wa-bill-detail` | Official bill metadata from WA Legislature API |
| GET | `/api/wa-bill-documents` | Document links (PDF, HTML, Word) |
| GET | `/api/wa-bill-text` | Raw bill text split into sections |
| GET | `/api/wa-bill-selection` | Sentence classification into rule units |
| POST | `/api/plain-meaning` | Plain-meaning extraction — accepts `{ text }` or `{ units }` |
| GET | `/api/openapi` | OpenAPI 3.1 spec |

---

## Repository structure

```
server.js                   Express server — routes, static files, /lib modules
render.yaml                 Render deployment config
vercel.json                 Vercel deployment config

api/                        One file per endpoint
lib/
  plain-meaning/
    pipeline.js             10-layer deterministic pipeline
    renderer.js             Scope-lens template renderer
  english-verbs.json        Verb list for the pipeline's obligation-language check
  synonymMap.json           RCW title synonym map for search

index.html                  Dashboard home
legislation.html            Bill reader
voting.html                 Voting resources

scripts/
  populate-bill-index.js    Populates data/wa/bill-index.json from WA Legislature API
  test-bills.js             Test harness — runs C1/C5/C6 quality checks against a local server

data/wa/
  bill-index.json           Active 2025-26 bills with sponsor, committee, and status fields
  test-bills.json           Bill numbers used by the test harness (25 bills)
  test-results.json         Output from test-bills.js — per-bill, per-criterion results
```

---

## Running locally

```bash
npm install
node server.js
```

Server starts on port 3000. No environment variables required — Redis features degrade gracefully without them.

| Variable | Used for |
|----------|---------|
| `UPSTASH_REDIS_REST_URL` | Redis — missing token queue and caching |
| `UPSTASH_REDIS_REST_TOKEN` | Redis — missing token queue and caching |
