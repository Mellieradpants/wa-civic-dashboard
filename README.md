# Washington Civic Dashboard

A civic dashboard that makes Washington State legislation readable for everyone — including people who don't speak English. Search any of 2,808 active 2025–26 bills, read what each section actually requires in plain language, and switch between 8 languages.

---

## Languages

English, Spanish, Somali, Russian, Ukrainian, Korean, Vietnamese, Tagalog.

---

## How the pipeline works

No AI in the data path. Everything is deterministic and traceable to source text. Missing information is flagged, not filled.

Input text runs through a 10-layer pipeline that detects section type, strips deleted text from amendments, extracts obligations, and renders plain sentences. A renderer turns those into output using one of six scope-lens templates.

For non-English output, sentence structure comes from language templates. Action phrases come from a dictionary populated automatically via Google Translate. Missing phrases are logged to Redis and translated on the next workflow run. Anything not yet translated shows with a `[!]` flag.

The bill index is populated from the WA Legislature API by a GitHub Actions workflow that runs daily and can be triggered manually.

---

## Translation state

Sentence templates are complete for all 7 non-English languages. The action phrase dictionary is growing — common legislative verbs are translated, edge cases still fall back to English with a `[!]` flag. Linguistic rule tuning per language is in progress.

Language-specific morphological rules (verb conjugation, noun cases, word order) are not built yet. Currently handled by dictionary lookup only.

---

## Tech stack

- Node.js, Express 4
- Vercel frontend, Render backend
- Bill index populated from WA Legislature API via GitHub Actions — updates daily
- Translation dictionary auto-populated via Google Translate API
- Missing tokens persist in Upstash Redis
- No database — bill index and translation dictionary are static JSON files

---

## API endpoints

Full spec at `/api/openapi`.

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/wa-bill-search` | Keyword or bill-number search |
| GET | `/api/wa-bill-detail` | Official bill metadata from WA Legislature API |
| GET | `/api/wa-bill-documents` | Document links (PDF, HTML, Word) |
| GET | `/api/wa-bill-text` | Raw bill text split into sections |
| GET | `/api/wa-bill-selection` | Sentence classification into rule units |
| POST | `/api/plain-meaning` | Plain-meaning extraction — accepts `{ text }` or `{ units }` |
| POST | `/api/translate-selection` | Re-renders ISC units in a target language |
| GET | `/api/missing-token` | Phrases not yet in the translation dictionary |
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
  translations.json         Sentence structure templates (7 languages)
  action-dictionary.json    Action phrase dictionary
  synonymMap.json           RCW title synonym map for search

index.html                  Dashboard home
legislation.html            Bill reader
voting.html                 Voting resources

scripts/
  populate-bill-index.js    Populates data/wa/bill-index.json from WA Legislature API
  seed-missing-tokens.js    Seeds Redis with verb/object pairs for translation
  translate-dictionary.js   Reads Redis, translates via Google Translate, writes dictionary

data/wa/
  bill-index.json           2,808 active 2025-26 bills
```

---

## Running locally

```bash
npm install
node server.js
```

Server starts on port 3000. No environment variables required — Redis and translation features degrade gracefully without them.

| Variable | Used for |
|----------|---------|
| `UPSTASH_REDIS_REST_URL` | Redis — missing token queue and caching |
| `UPSTASH_REDIS_REST_TOKEN` | Redis — missing token queue and caching |
