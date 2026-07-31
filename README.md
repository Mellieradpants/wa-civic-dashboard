# Washington Civic Dashboard

A civic dashboard that makes Washington State legislation readable in plain English. Search any of the 2,517 distinct 2025–26 bills (2,808 listings in the index, since substitute stages like HB/SHB/2SHB share one underlying bill) and read what each section actually requires in plain language.

---

## Project philosophy

This project favors deterministic behavior, traceability, and explicit limitations over inferred or generated output. Documentation describes the current implementation, not future design goals.

---

## Status

This is a student project in active development. It is not a legal reference and should not be relied upon for legal purposes. Always consult the official bill text, which is linked on every page.

Output contains known limitations and implementation errors. See "How this is tested" for what is and is not currently verified.

---

## How the pipeline works

No AI in the data path. Everything is deterministic. Every rendered sentence is traceable to an exact span of source text. Provisions that carry no requirement word are currently not rendered at all, and that omission is not yet flagged to the reader.

Input text runs through a 10-layer pipeline that detects section type, strips deleted text from amendments, and extracts obligations, permissions, and prohibitions. A renderer turns those into output using one of six scope-lens templates.

The bill index is populated from the WA Legislature API by a GitHub Actions workflow that runs daily and can be triggered manually.

---

## Known limitations

Known defects are tracked as repository issues. The list is not short, and it includes provisions that are dropped without notice, provisions from adjacent subsections being combined into one sentence, and permissions rendered as obligations in some sentence shapes.

---

## How this is tested

Two different things, doing two different jobs.

**Hand-checking bills.** A bill is run through the pipeline and the output is read line by line against the official source text. This is the only way meaning errors are found — a sentence can be well-formed, traceable to source, and still say the wrong thing. It is slow and manual, and it is where every real defect in this project has come from.

**Automated regression suites.** Each defect found by hand-checking gets a test built from the real bill sentence that produced it. Those suites run on every pull request. They do not measure accuracy — they only prove that a bug already found and fixed has not come back.

A separate harness runs five invariant checks over the bill corpus: output is non-empty, contains no formatting artifacts, has no duplicate paragraphs, every rendered sentence's anchor text appears in the source, and every recorded position reproduces its recorded text when the source is sliced. These check that output is well-formed and traceable to its source. They do not check that the plain-English meaning is correct.

### From hand-checking to merged code

Every fix in this project follows the same path.

1. **Read one bill against its source.** The official bill text and the rendered output are read side by side, line by line, looking for where they diverge — content dropped, two provisions welded into one sentence, a permission stated as an obligation, a sentence left without its object.

2. **Trace the defect to the code.** The exact sentence that failed is run through the pipeline on its own to find which function produced the wrong result. The cause has to be reproduced before anything is written.

3. **Require a real example.** No fix is built without a real bill sentence proving the problem actually occurs in real text. If no real example exists, the idea is written down as a future direction instead of being built.

4. **Fix on a branch.** Nothing is pushed directly to the main branch.

5. **Lock the fix with the real sentence.** The verbatim sentence that exposed the defect is added to a regression suite with its correct expected result, so the bug cannot come back unnoticed. Test cases are real bill text, never invented examples.

6. **Open a pull request.** An automated check re-runs the harness on a sample of bills and blocks the merge on any new failure, while allowing failures that were already present before the change.

7. **Merge, then re-render the same bill.** The fix is confirmed on the bill that exposed it, and the rest of the corpus is compared before and after to confirm nothing else moved.

8. **Repeat on the same bill** until it renders clean, then move to the next bill.

Fixes are made one at a time, each in its own pull request, rather than batched. Each defect gets its own detector or correction so that a change to one does not quietly alter another.

---

## Designed, Not Yet Implemented

Design work and open questions, listed separately so they are not mistaken for things the code currently does.

- **Value terms.** When a bill uses a term such as "good faith" or "equity", the pipeline checks whether the bill resolves it: defined within the bill, handed to a named authority to decide, or left open. Detection for "handed to an authority" and "left open" is implemented. Surfacing any of it to the reader is not.
- **Conditions, exceptions, and limits.** Showing a rule's conditions and exceptions separately from the rule itself, rather than blending them into a single sentence. Designed, not implemented.
- **RCW citations.** Bills cross-reference RCW sections throughout. Those citations are currently treated as plain text and are never resolved.
- **Flagging omitted provisions.** A provision with no requirement word currently produces no output. It should at minimum be shown as unrendered rather than omitted silently.

---

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
