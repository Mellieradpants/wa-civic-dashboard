# WA Civic Dashboard — Claude Session Briefing

## What this project is

A Washington State civic information dashboard. Backend is an Express 4 API deployed on Render (`server.js` + `render.yaml`). Frontend is three HTML pages (`index.html`, `legislation.html`, `voting.html`) served by the same Express server. The API also serves `/lib` as static ES modules for browser imports.

The core product commitment: plain-language bill meaning is produced **deterministically**, without AI calls. The 10-layer pipeline and scope-lens renderer are the mechanism. AI is only used for translation (`/api/wa-bill-translate`), section-level interpretation (`/api/analyze`), and search query expansion (`/api/wa-bill-search`).

---

## Architecture rules — do not break these

### Plain meaning is deterministic — no exceptions
`/api/plain-meaning` runs text through the 10-layer pipeline (`lib/plain-meaning/pipeline.js`) and the scope-lens renderer (`lib/plain-meaning/renderer.js`). No AI call is made anywhere in that path. The dashboard's "Plain meaning" card in `legislation.html` calls `/api/wa-bill-text` → `/api/plain-meaning`. Do not reroute either of these through Anthropic or any other model.

### The `units` input path is the primary TCS integration point
`POST /api/plain-meaning` accepts either `{ text }` (raw string, runs the full JS pipeline — fallback only) or `{ units }` (pre-processed ISC array from the TCS Python pipeline — primary path). The `units` path skips directly to the renderer. Do not remove or change the `units` input schema — it is the integration contract with the TCS pipeline.

### ISC unit schema is a contract
The `IscUnit` shape (`tetherAnchor`, `parse.who/what/when/where/how`, `missingSignals`, `status`) is shared with the TCS Python pipeline. Do not rename fields or change nesting without coordinating with TCS.

### The 6 scope lenses are fixed
`modality_shift`, `actor_power_shift`, `scope_change`, `threshold_shift`, `action_domain_shift`, `obligation_removal`. These mirror the meaning-buddy taxonomy. New lenses require updating both `LENS_PATTERNS` in `renderer.js` and the `PlainMeaningSentence` schema in `openapi.js`.

---

## Pipeline — 10 layers, all deterministic

```
L1  5WIH   — who/what/when/where/why/how assembly
L2  SSE    — signal detection (obligation / permission / prohibition)
L3  CFS    — constraint filter (blocks intent/narrative language)
L4  LNS    — language normalization (strips section headers)
L5  AAC    — actor-action-condition parsing
L6  TPS    — temporal parsing (deadlines, triggers, sequence)
L7  SJM    — system/jurisdiction mapping
L8  MPS    — mechanism parsing (how + enforcement)
L9  RDS    — risk decomposition
L10 ISC    — information set construction (assembles the unit)
```

All layers are in `lib/plain-meaning/pipeline.js`. The renderer (`lib/plain-meaning/renderer.js`) is a separate step that runs after the pipeline.

### Known design decisions in the pipeline (do not revert)
- `MODAL_RE` includes `is responsible for|are responsible for` before `is required to` — needed so SSE detects actor-authority sentences without a modal verb.
- `cleanAction` does NOT strip `of each X` — that was removed because it lost meaningful target context.
- `obligation_removal` template checks for co-present threshold data and appends it — a conditional removal is not rendered as a blanket removal.
- `TEMPORAL_SUFFIX_RE` uses `[^;.]` not `[^,;.]` — allows commas inside dates like "no later than January 1, 2026".
- Lens classifier order is intentional: `obligation_removal` → `threshold_shift` → `actor_power_shift` → `action_domain_shift` → `scope_change` → default `modality_shift`. First match wins.

---

## Git and branch conventions

- **Always develop on a feature branch.** Never commit directly to `main` without asking first.
- **Ask before merging to main.** Confirm PR vs. direct push. Default to PR unless told otherwise.
- **Before pushing to main**, check whether remote main has commits the local branch doesn't (`git log --oneline origin/main..HEAD` and `git log --oneline HEAD..origin/main`). Fetch and rebase cleanly before pushing.
- Commit messages: describe the *why*, not the what. No model identifiers in commit messages.

---

## Server and deployment

- `server.js` — Express 4, dynamically imports all API handlers, registers method-specific routes + OPTIONS + `app.all` catch-all (JSON 405 for wrong-method requests).
- `render.yaml` — single Render web service, `node server.js` as start command.
- HTML pages (`index.html`, `legislation.html`, `voting.html`) are served by Express directly — do not add a separate static host.
- `/lib` is served as a static route so browser ES module imports (e.g. `import from '/lib/wa-adapter/index.js'`) resolve.
- All API calls in the frontend use **relative URLs** — same origin, same server. Do not hardcode absolute URLs in the HTML pages.
- The health check (`GET /api/health`) returns `serviceUrl` and `plainMeaningEndpoint` derived from the request `host` header — this is how deployed clients discover the Render URL.

---

## Environment variables (Render)

| Key | Used by |
|-----|---------|
| `Anthropic_API_Key` | `/api/analyze`, `/api/wa-bill-translate`, `/api/wa-bill-plain-summary`, `/api/wa-bill-search` (query expansion) |
| `gemini_api_key` | `/api/health` (ping check only) |
| `UPSTASH_REDIS_REST_URL` | Redis cache — optional, degrades gracefully if missing |
| `UPSTASH_REDIS_REST_TOKEN` | Redis cache — optional, degrades gracefully if missing |

Redis failures are always silent (`try/catch` around every Redis call). The server starts and functions correctly without any of these keys.

---

## Code style

- No comments unless the *why* is genuinely non-obvious (a hidden constraint, a workaround for a specific bug, a subtle invariant).
- No multi-line comment blocks or docstrings.
- No features beyond what the task requires. No abstraction for hypothetical future use.
- No error handling for scenarios that cannot happen. Trust framework guarantees.
- Validate only at system boundaries (user input, external APIs).
- Default to editing existing files. Only create new files when genuinely required.

---

## Files map

```
server.js                        — Express server, route registration, static file serving
render.yaml                      — Render deployment config
package.json                     — dependencies: express, @upstash/redis

api/
  health.js                      — GET  /api/health
  openapi.js                     — GET  /api/openapi (full OpenAPI 3.1 spec)
  plain-meaning.js               — POST /api/plain-meaning (deterministic, no AI)
  wa-bill-search.js              — GET  /api/wa-bill-search
  wa-bill-detail.js              — GET  /api/wa-bill-detail
  wa-bill-documents.js           — GET  /api/wa-bill-documents
  wa-bill-text.js                — GET  /api/wa-bill-text
  wa-bill-selection.js           — GET  /api/wa-bill-selection
  wa-bill-plain-summary.js       — GET  /api/wa-bill-plain-summary (AI, legacy — not used by dashboard)
  wa-bill-translate.js           — POST /api/wa-bill-translate (AI)
  analyze.js                     — POST /api/analyze (AI, per-section)

lib/
  plain-meaning/
    pipeline.js                  — 10-layer deterministic pipeline (runPipeline)
    renderer.js                  — scope-lens template renderer (renderISC, renderUnit)
  wa-adapter/
    index.js                     — WA Legislature API adapter (getNormalizedBill)

index.html                       — dashboard home
legislation.html                 — bill reader (search, plain meaning, sections)
voting.html                      — voting resources
scripts/populate-bill-index.js   — build-time script to populate data/wa/bill-index.json
```
