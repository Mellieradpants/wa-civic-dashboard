# Washington Civic Dashboard

A plain-language access layer for Washington State legislation. The dashboard retrieves official bill records, extracts structured rule units through a deterministic 10-layer parsing pipeline, and renders plain-meaning sentences — without AI calls for bill analysis.

Deployed as a single service on Render. The API and the three-page frontend are served from the same Express server.

---

## How it works

When a user selects a bill in the dashboard:

1. **Bill metadata** is fetched from the WA Legislature SOAP API
2. **Official document links** are scraped from the WA Legislature document search
3. **Raw bill text** is fetched from the official HTML bill document and split into sections
4. **Plain meaning** is extracted by running the bill text through the 10-layer deterministic pipeline — no AI involved

The pipeline (described below) parses the bill text for signal sentences (obligations, permissions, prohibitions), extracts structured fields (actor, action, conditions, deadlines, jurisdiction), classifies each sentence into one of six scope lenses, and renders a plain-language sentence from a fixed template. The result is deterministic and reproducible.

AI is used only for three secondary features: search query expansion, per-section interpretation (when a user opens a section panel), and translation into Spanish, Somali, Vietnamese, or Tagalog.

---

## The 10-layer pipeline

All layers are deterministic. No model calls. Lives in `lib/plain-meaning/pipeline.js`.

| Layer | Name | What it does |
|-------|------|--------------|
| L1 | 5WIH | Who / What / When / Where / Why / How assembly |
| L2 | SSE | Source statement extraction — detects obligation, permission, and prohibition signal sentences |
| L3 | CFS | Constraint filter — blocks intent, narrative, and purpose language |
| L4 | LNS | Language normalization — strips section headers and whitespace noise |
| L5 | AAC | Actor-action-condition parsing — extracts responsible party, modal verb, action, and conditional clauses |
| L6 | TPS | Temporal parsing — extracts deadlines, triggers, and sequence signals |
| L7 | SJM | System/jurisdiction mapping — identifies Washington State vs. federal references and controlling entities |
| L8 | MPS | Mechanism parsing — extracts how a requirement is fulfilled and enforcement language |
| L9 | RDS | Risk decomposition — separates likelihood signals from consequence signals |
| L10 | ISC | Information set construction — assembles the structured unit from all prior layers |

The renderer (`lib/plain-meaning/renderer.js`) takes ISC units and applies one of six scope-lens sentence templates to produce plain-language output.

### Scope lenses

| Lens | Triggered by |
|------|-------------|
| `obligation_removal` | "no longer required", "waived", "exempted" |
| `threshold_shift` | numeric standards, deadlines, percentages, "no less than", "minimum" |
| `actor_power_shift` | "responsible for", "authorized to", "delegated", "reports to" |
| `action_domain_shift` | inspect, audit, certify, train, document, implement, maintain |
| `scope_change` | all, every, each, none, throughout, across all |
| `modality_shift` | default — any obligation, permission, or prohibition not matched above |

### Two input paths

The `/api/plain-meaning` endpoint accepts either:

- **`{ text }`** — raw bill or policy text. The full JS pipeline runs internally. Use this when calling from the dashboard or sending raw text.
- **`{ units }`** — pre-processed ISC units from the TCS Python pipeline. Skips directly to the renderer. This is the primary integration path when the TCS pipeline is running upstream.

---

## API endpoints

All endpoints are documented in the live OpenAPI spec at `/api/openapi`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Service health check. Returns `serviceUrl` and `plainMeaningEndpoint` so clients can discover the deployed URL. |
| GET | `/api/openapi` | OpenAPI 3.1 specification for all endpoints. |
| POST | `/api/plain-meaning` | Deterministic plain-meaning extraction. No AI. Accepts `{ text }` or `{ units }`. |
| GET | `/api/wa-bill-search` | Keyword or bill-number search against the local bill index, with optional AI query expansion. |
| GET | `/api/wa-bill-detail` | Official bill metadata from the WA Legislature SOAP API. |
| GET | `/api/wa-bill-documents` | Official document links (PDF, HTML, Word) scraped from the WA Legislature. |
| GET | `/api/wa-bill-text` | Raw bill text extracted from the official HTML document, split into sections. |
| GET | `/api/wa-bill-selection` | Classifies bill sentences into rule candidate units (obligation, prohibition, permission, condition, exception, definition, reference). |
| GET | `/api/wa-bill-plain-summary` | AI-generated plain-language paragraph via Anthropic Claude. Results cached in Redis for 7 days. |
| POST | `/api/wa-bill-translate` | Translates a plain-language summary into Spanish, Somali, Vietnamese, or Tagalog via Anthropic Claude. Cached 30 days. |
| POST | `/api/analyze` | Translates a section of text into a plain-language paragraph via Anthropic Claude. |

---

## Repository structure

```
server.js                        Express 4 server — registers all API handlers,
                                 serves HTML pages and /lib static modules

render.yaml                      Render deployment config (single web service)
package.json                     Dependencies: express, @upstash/redis

api/
  health.js                      GET  /api/health
  openapi.js                     GET  /api/openapi
  plain-meaning.js               POST /api/plain-meaning
  wa-bill-search.js              GET  /api/wa-bill-search
  wa-bill-detail.js              GET  /api/wa-bill-detail
  wa-bill-documents.js           GET  /api/wa-bill-documents
  wa-bill-text.js                GET  /api/wa-bill-text
  wa-bill-selection.js           GET  /api/wa-bill-selection
  wa-bill-plain-summary.js       GET  /api/wa-bill-plain-summary
  wa-bill-translate.js           POST /api/wa-bill-translate
  analyze.js                     POST /api/analyze

lib/
  plain-meaning/
    pipeline.js                  10-layer deterministic pipeline (runPipeline)
    renderer.js                  Scope-lens template renderer (renderISC, renderUnit)
  wa-adapter/
    index.js                     WA Legislature API adapter (getNormalizedBill)

index.html                       Dashboard home page
legislation.html                 Bill reader — search, plain meaning, sections, translation
voting.html                      Voting resources

scripts/
  populate-bill-index.js         Build-time script — populates data/wa/bill-index.json
                                 from the WA Legislature bulk API

data/
  wa/
    bill-index.json              Local bill index used by /api/wa-bill-search
```

---

## Running locally

```bash
npm install
node server.js
```

The server starts on port 3000. Open `http://localhost:3000/legislation.html` for the bill reader or `http://localhost:3000/api/openapi` for the full API spec.

The service runs without any environment variables configured — all external API features degrade gracefully.

---

## Environment variables

Set these in Render (or a local `.env`). None are required for the server to start.

| Variable | Required for |
|----------|-------------|
| `Anthropic_API_Key` | Bill plain summary, translation, section interpretation, search query expansion |
| `gemini_api_key` | Health check ping (Gemini connectivity check only) |
| `UPSTASH_REDIS_REST_URL` | Redis caching for summaries and translations |
| `UPSTASH_REDIS_REST_TOKEN` | Redis caching for summaries and translations |

Redis is optional. All cache reads and writes are wrapped in silent `try/catch` — the service functions fully without it, just without caching.

---

## Deployment

The project deploys as a single Render web service defined in `render.yaml`.

```
Build:  npm install
Start:  node server.js
```

On first deploy, run the bill index build to populate the search index:

```bash
node scripts/populate-bill-index.js
```

Once deployed, call `/api/health` to confirm the service URL and verify connectivity. The response includes `serviceUrl` and `plainMeaningEndpoint` for client configuration.

---

## Design principles

**Plain meaning is never AI-generated.** The 10-layer pipeline and scope-lens renderer produce all plain-meaning output deterministically. The same input always produces the same output. This is intentional — bill analysis should be auditable and reproducible, not variable by model version or prompt drift.

**Official sources first.** The dashboard links back to official WA Legislature records at every step. It does not replace official sources or provide political recommendations.

**Graceful degradation.** Missing API keys and Redis failures never crash the server. Features that depend on external services return clear error states; everything else continues to work.
