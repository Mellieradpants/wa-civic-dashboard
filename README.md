# Washington Civic Dashboard

A civic dashboard that makes Washington State legislation readable for everyone — including people who don't speak English. Look up any bill, read what it actually requires in plain language, switch between 8 languages.

---

## Languages

English, Spanish, Somali, Russian, Ukrainian, Korean, Vietnamese, Tagalog.

---

## What it does

- Search 2,808 active 2025–26 WA bills by keyword or number
- Read official bill sections
- See plain meaning output — what each section actually requires, permits, or prohibits
- Switch languages and get native-language output
- See section type labels — addition, amendment, repeal, appropriation

---

## How the pipeline works

No AI anywhere in the data path. Everything is deterministic and traceable to source text. Missing information is flagged, not filled.

Input text runs through a 10-layer pipeline that extracts who, what, when, where, why, and how. A renderer turns that into plain sentences using one of six scope-lens templates.

For non-English output, sentence structure comes from static translation templates. Action phrases come from a token dictionary — if a phrase isn't in the dictionary yet, the output flags it with `[!]` and logs it to `lib/missing-tokens.txt` for a human translator to add.

The bill index is populated from the WA Legislature bulk API by running `scripts/populate-bill-index.js`. That script needs outbound network access to `wslwebservices.leg.wa.gov` — run it locally or via CI, not from Render.

---

## Translation state

Sentence structure templates are complete for all 7 non-English languages. The action phrase dictionary is a seed — one verb, one object. Most action phrases in real bills will show a `[!]` flag until human translators fill them in. That's by design. The translator work queue is at `GET /api/missing-token`.

---

## Tech stack

- Node.js, Express 4
- Vercel frontend, Render backend
- No AI dependencies
- No database — bill index is `data/wa/bill-index.json`, a static file
- Translation dictionary is `lib/action-dictionary.json`, a static file
- Missing tokens write to `lib/missing-tokens.txt`, a flat file

---

## API endpoints

Full spec at `/api/openapi`.

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/api/health` | Health check — confirms service URL and WA Legislature API reachability |
| GET | `/api/wa-bill-search` | Keyword or bill-number search against the local index |
| GET | `/api/wa-bill-detail` | Official bill metadata from the WA Legislature SOAP API |
| GET | `/api/wa-bill-documents` | Official document links (PDF, HTML, Word) |
| GET | `/api/wa-bill-text` | Raw bill text split into sections |
| GET | `/api/wa-bill-selection` | Sentence classification into rule candidate units |
| POST | `/api/plain-meaning` | Plain-meaning extraction — accepts `{ text }` or `{ units }` |
| POST | `/api/translate-selection` | Re-renders ISC units in a target language |
| GET | `/api/missing-token` | Translator work queue — phrases not yet in the dictionary |
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
  action-dictionary.json    Action phrase token dictionary
  missing-tokens.txt        Flat log of phrases not yet translated
  synonymMap.json           RCW title synonym map for search

index.html                  Dashboard home
legislation.html            Bill reader
voting.html                 Voting resources

scripts/
  populate-bill-index.js    Populates data/wa/bill-index.json from WA Legislature API

data/wa/
  bill-index.json           2,808 active 2025-26 bills
```

---

## Running locally

```bash
npm install
node server.js
```

Server starts on port 3000. No environment variables required — everything degrades gracefully without them.

| Variable | Used for |
|----------|---------|
| `UPSTASH_REDIS_REST_URL` | Redis caching (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | Redis caching (optional) |
