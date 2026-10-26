# Washington Civic Dashboard

A civic dashboard that makes Washington State legislation readable in plain meaning. Search any of the 2,517 distinct 2025–26 bills (2,808 listings in the index, since substitute stages like HB/SHB/2SHB share one underlying bill) and read what each section actually requires in plain language.



This is a student project in active development. It is not a legal reference and should not be relied upon for legal purposes. Always consult the official bill text, which is linked on every page.


## How the pipeline works

No AI in the data path. Everything is deterministic. Every rendered sentence is traceable to an exact span of source text. 
Input text runs through a 10-layer pipeline that detects section type, strips deleted text from amendments, and extracts obligations, permissions, and prohibitions. A renderer turns those into output using one of six scope-lens templates.

The bill index is populated from the WA Legislature API by a GitHub Actions workflow that runs daily and can be triggered manually.





## Tech stack

- Node.js, Express 4
- Single Render service — Express serves both the API and the HTML pages
- Live at `https://https-github-com-mellieradpants-wa-civic.onrender.com`
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
    templates.js            Scope-lens template functions
  english-verbs.json        Verb list for the pipeline's obligation-language check
  synonymMap.json           RCW title synonym map for search

index.html                  Dashboard home
legislation.html            Bill reader
voting.html                 Voting resources

scripts/
  populate-bill-index.js    Populates data/wa/bill-index.json from WA Legislature API
  build-bill-corpus.js      One-time corpus builder for phrase-scanning and validation work
  test-bills.js             Test harness — runs C1/C4/C5/C6/L1 checks against a local server
  test-*.js                 One regression suite per fixed defect, each paired with its own
                             fixture file in data/wa/ (see "How this is tested" above)

data/wa/
  bill-index.json           Active 2025-26 bills with sponsor, committee, and status fields
  test-bills.json           Test harness configuration — round-robin sample size, fixed
                             sentinel bills, known no-document bills, known boilerplate,
                             and known per-bill check exemptions
  test-results.json         Output from test-bills.js — per-bill, per-criterion results
  *-test-cases.json         Fixtures for the scripts/test-*.js regression suites — each
                             entry is a verbatim real bill sentence with its expected result
  value-term-deferred-cases.md
                             Notes on value-term detection cases deferred for lack of a
                             real bill anchor
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

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
