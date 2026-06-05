# Washington Civic Dashboard

A civic dashboard that makes Washington State legislation readable for everyone — including people who don't speak English. Search any of 2,808 active 2025–26 bills, read what each section actually requires in plain language, and switch between 8 languages.

---

## Languages

English, Spanish, Somali, Russian, Ukrainian, Korean, Vietnamese, Tagalog.

---

## How the pipeline works

No AI in the data path. Everything is deterministic and traceable to source text. Missing information is flagged, not filled.

Input text runs through a 10-layer pipeline that detects section type, strips deleted text from amendments, extracts obligations, and renders plain sentences. A renderer turns those into output using one of six scope-lens templates.

For non-English output, sentence structure comes from language templates. Before the dictionary lookup runs, two substitution passes localize the action string: a semantic alias pass replaces canonical legal terms with culturally preferred equivalents, and a connective phrase pass replaces legislative connectives ("pursuant to", "notwithstanding", etc.). Action phrases not covered by either pass fall back to English with a `[!]` flag. The dictionary is maintained manually through reference translation passes.

The bill index is populated from the WA Legislature API by a GitHub Actions workflow that runs daily and can be triggered manually.

---

## Translation state

Sentence templates are complete for all 7 non-English languages. The action phrase dictionary is maintained manually through reference translation passes — entries are reviewed for legal register before being committed. Common legislative verbs and connective phrases are covered; edge cases fall back to English with a `[!]` flag.

Language-specific morphological rules (verb conjugation, noun cases, word order) are partially implemented via per-language normalization in the renderer. Dictionary lookup handles the remainder.

---

## Tech stack

- Node.js, Express 4
- Single Render service — Express serves both the API and the HTML pages
- Bill index populated from WA Legislature API via GitHub Actions — updates daily
- Translation dictionary managed manually — no external translation API
- Upstash Redis — optional cache layer, degrades gracefully if absent
- No database — bill index, translation dictionary, and semantic aliases are static JSON files

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
| POST | `/api/translate-selection` | Re-renders ISC units in a target language |
| GET | `/api/missing-token` | Phrases not yet in the translation dictionary (requires Redis) |
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
    renderer.js             Scope-lens template renderer — includes semantic alias
                            and connective substitution passes for non-English output
  translations.json         Sentence structure templates (7 languages)
  action-dictionary.json    Action phrase dictionary — also contains "connectives" section
  semantic-aliases.json     Canonical legal terms → culturally preferred equivalents
  synonymMap.json           RCW title synonym map for search

index.html                  Dashboard home
legislation.html            Bill reader
voting.html                 Voting resources

scripts/
  populate-bill-index.js    Populates data/wa/bill-index.json from WA Legislature API
  seed-missing-tokens.js    Seeds Redis with missing verb/object pairs (workflow disabled)
  translate-dictionary.js   Writes translated entries to action-dictionary.json (workflow disabled)

data/wa/
  bill-index.json           Active 2025-26 bills with sponsor, committee, and status fields
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
