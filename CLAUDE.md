# WA Civic Dashboard — Claude Session Briefing

## What this project is

A Washington State civic information dashboard. Backend is an Express 4 API deployed on Render (`server.js` + `render.yaml`). Frontend is three HTML pages (`index.html`, `legislation.html`, `voting.html`) served by the same Express server. The API also serves `/lib` as static ES modules for browser imports.

The core product commitment: the entire service is **fully deterministic with zero external AI API calls**. The 10-layer pipeline and scope-lens renderer produce plain meaning. Multi-language output uses static templates in `lib/translations.json`. Search uses synonym expansion from `lib/synonymMap.json`. No Anthropic, Gemini, or any other LLM is called at runtime.

---

## Architecture rules — do not break these

### Plain meaning is deterministic — no exceptions
`/api/plain-meaning` runs text through the 10-layer pipeline (`lib/plain-meaning/pipeline.js`) and the scope-lens renderer (`lib/plain-meaning/renderer.js`). No AI call is made anywhere in that path. The dashboard's "Plain meaning" card in `legislation.html` calls `/api/wa-bill-text` → `/api/plain-meaning`. Do not reroute either of these through Anthropic or any other model.

### The `units` input path is the primary TCS integration point
`POST /api/plain-meaning` accepts either `{ text }` (raw string, runs the full JS pipeline — fallback only) or `{ units }` (pre-processed ISC array from the TCS Python pipeline — primary path). The `units` path skips directly to the renderer. Do not remove or change the `units` input schema — it is the integration contract with the TCS pipeline.

### ISC unit schema — current shape
`parse.who` contains `responsibleParty` (string | null) and `modal` (string | null). The `actors` array and `decisionAuthority` field were removed — both were always equal to `responsibleParty` and neither was read by the renderer. TCS integration was confirmed inactive; there is no external pipeline consuming this schema.

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
- `MODAL_RE` also includes `must be adjusted|must be rounded` — obligation signals for rounding/adjustment clauses that have no traditional modal verb.
- `cleanAction` does NOT strip `of each X` — that was removed because it lost meaningful target context.
- `obligation_removal` template checks for co-present threshold data and appends it — a conditional removal is not rendered as a blanket removal.
- `TEMPORAL_SUFFIX_RE` uses `[^;.]` not `[^,;.]` — allows commas inside dates like "no later than January 1, 2026".
- Lens classifier order is intentional: `obligation_removal` → `threshold_shift` → `actor_power_shift` → `action_domain_shift` → `scope_change` → default `modality_shift`. First match wins.
- `threshold_shift` cash-rounding template only fires when text contains **both** rounding language AND a cent-amount pattern — prevents false positives on non-monetary rounding.
- `(( ))` WA legislative markup (struck/substituted text) is stripped in two places: (1) in `pipeline.js` before SSE runs, (2) in `wa-bill-text.js` before the text is returned from the API. Both strips are required; removing either causes raw markup to appear in output.
- Amendment header strip runs in `runPipeline` **after** section type detection but **before** SSE — the "is amended to read as follows:" phrase is needed for type detection and must be removed before sentence extraction so it never becomes an actor.
- Subsection navigation markers `(1)`, `(2)(a)`, `(a)`, `(b)` etc. are stripped in `runPipeline` after the amendment header strip. They are structural navigation artifacts that pollute actor/action extraction; they carry no semantic content.
- `renderISC` joins multiple obligation sentences with `"\n\n"` not `" "` — multiple obligations within one section must render as distinct paragraphs, not a run-on block.
- `modalVerb` gives SSE signal priority over the positional MODAL_RE string match — `signal === "obligation"` returns "must" before `m === "may"` is checked. This prevents sentences where "may" appears before "shall" in the text from rendering as permission.
- `parseActorActionCondition` (L5 AAC) strips leading condition clauses from the actor string. If the pre-modal text starts with `if/when/unless/until/except/provided that/in the event`, the actor is taken from the text after the last comma, with prepositional-fragment tails rejected. No clean tail → actor is null.
- `cleanAction` strips a leading comma+space from the action string — prevents `"must , at intervals..."` artifacts when a mid-clause modal is followed by a comma-delimited adverbial phrase.
- `scope_change` lens trigger is intentionally narrow: only `throughout`, `across all`, `all covered`, `applies? to`, `regardless of`. Generic words like `all/each/any` were removed to prevent false-positive scope_change classification on nearly every section.

### Section type detection (pre-pipeline step — do not remove)
Before L1, each section is classified by type. The 6 types are: `addition`, `amendment`, `repeal`, `delayed`, `appropriation`, `standard`. The type is stored on the ISC unit as `sectionType`. This classification runs in `pipeline.js` (look for `classifySectionType`). Do not move this into a lens or post-render step — it must tag the unit before extraction so the renderer can use it.

---

## Known pipeline limitations — confirmed, not fixable without scoped pipeline changes

- **"May [date]"** — month "May" triggers modal substitution before the temporal parser can protect date context.
- **"shall be construed"** — misidentifies as wrong modal frame.
- **"provided that" and "subject to"** — fail to substitute in Somali and Korean; entries exist in the dictionary, failure is in `sanitizeSomaliOutput` / `sanitizeKoreanOutput` — constrained, do not touch.

---

## Git and branch conventions

- **Always push directly to main.** No feature branch by default. If any prior instruction, workflow file, or config references a different branch, disregard it and flag it.
- **Surface conflicts, don't resolve them silently.** If something contradicts the current instruction, raise it before acting.
- Commit messages: describe the *why*, not the what. No model identifiers in commit messages.

---

## Bill number routing

`wa-bill-detail.js` contains `BILL_TYPE_RULES` — an array that maps bill number ranges to bill type metadata. Do not remove or collapse this — `displayNumber`, `abbreviation`, `recordType`, and `chamber` in the API response all come from it.

| Range | Abbreviation | Type |
|-------|-------------|------|
| 1000–3999 | HB | House Bill |
| 5000–7999 | SB | Senate Bill |
| 4000–4199 | HJM | House Joint Memorial |
| 4200–4399 | HJR | House Joint Resolution |
| 4400–4599 | HCR | House Concurrent Resolution |
| 4600–4999 | HR | House Resolution |
| 8000–8199 | SJM | Senate Joint Memorial |
| 8200–8399 | SJR | Senate Joint Resolution |
| 8400–8599 | SCR | Senate Concurrent Resolution |
| 8600–8999 | SR | Senate Resolution |
| 9000–9999 | SGA | Senate Gubernatorial Appointment |

### RCW citation stripping in `extractBillNumber`
Every handler that accepts user-supplied bill input uses a local `extractBillNumber` helper that **first strips RCW citations** (`replace(/\bRCW\s+[\d.A-Za-z]+/gi, "")`) before matching the numeric bill number. This prevents "RCW 70A.565.020" from yielding "565" as a bill number. `wa-bill-selection.js` has the canonical implementation with an explanatory comment; all others should match it.

---

## Internal module coupling rules

### wa-bill-text exports fetchBillTextData for direct use
`api/wa-bill-text.js` exports a named function `fetchBillTextData(billNumber, biennium)` in addition to its default HTTP handler. This is the same logic the handler runs — HTML fetch, `(( ))` strip, section split — but callable without HTTP. Use it when another module needs bill text data during a single request.

### wa-bill-selection uses fetchBillTextData directly — no HTTP self-call
`api/wa-bill-selection.js` imports `fetchBillTextData` from `./wa-bill-text.js` and calls it directly. There is no `getBaseUrl` / self-referential HTTP fetch. Do not reintroduce an HTTP self-call here.

### legislation.html: bill text fetched once per load, shared via Promise
`legislation.html` uses `makeBillTextPromise(record)` to create a single `fetch` Promise for the bill text endpoint. Both `loadBillText` and `loadBillPlainSummary` receive this Promise as `textDataPromise` and `await` it. The underlying HTTP request fires once; both consumers share the resolved value. The selection fetch inside `loadBillText` is fire-and-forget (not awaited).

---

## Bill index

`data/wa/bill-index.json` — the search index consumed by `/api/wa-bill-search`. Generated by `scripts/populate-bill-index.js`.

- **Tagging is deterministic** — no AI. Each bill is tagged by which RCW title numbers appear in its `ShortDescription`, `LongDescription`, and `LegalTitle`.
- **RCW taxonomy** is hardcoded in `populate-bill-index.js` as `TAXONOMY` — 10 categories, 31 subcategories, ~35 title mappings. Edit `TAXONOMY` there to change how bills are classified.
- **Run from a network-permitted environment** — `wslwebservices.leg.wa.gov` returns 403 from Render's container. Run the script locally or from CI with outbound access: `node scripts/populate-bill-index.js`.
- Bills with no RCW title match are included in the index with `categories: []` — they show up in unfiltered searches but are excluded from category filters.
- **Per-bill fields in the index**: `bill_id_display`, `bill_id_normalized`, `bill_number`, `chamber`, `title`, `legal_title`, `session`, `status`, `sponsor`, `introducedDate`, `historyLine`, `committee`, `keywords`, `source_url`, `detail_api_path`. The `sponsor`, `introducedDate`, `historyLine`, and `committee` fields are populated from the WA Legislature XML API during the populate run.
- **`mapRecord()` in `wa-bill-search.js`** passes `sponsor`, `introducedDate`, `historyLine`, `committee`, and `legal_title` through to the search API response. `legislation.html` uses these as fallbacks when the live detail API is unavailable.
- **`keywords` field is empty on all 2,808 records** — the field exists in the index schema and `TAXONOMY` is hardcoded in `populate-bill-index.js`, but keyword tagging was never implemented as working code. Do not treat `keywords` as a reliable filter.

---

## Validation and compliance

- Output is validated against a 338-bill sample from the 2,808-bill 2025–26 corpus at 95% confidence, ±5% margin of error, finite population correction applied.
- A two-tier pass/fail rubric (13 criteria) is defined: Tier 1 (C1–C7) is machine-scoreable and applied to all 338 bills × 7 languages; Tier 2 (C8–C13) requires human review and applies to a 10–20 bill spot-check subset.
- This tool is built to support Washington State SHB 2475 language access requirements for LEP communities.
- Structural correctness claim is defensible. Communicative accuracy claim requires completion of Tier 2 human review — not yet complete.

---

## Localized rendering design (do not revert)

### Connective phrase substitution pass
`DICTIONARY.connectives` in `action-dictionary.json` holds multi-word connective phrases ("pursuant to", "notwithstanding", "in accordance with", etc.) with per-language translations. At module load, `CONNECTIVE_ENTRIES` is built from this section and sorted longest-first. `substituteConnectives(obj, lang)` runs on the `obj` string after the verb/obj split, before the dictionary lookup — replaces connective substrings so they don't bleed through as English inside otherwise-translated sentences. Add new connectives by adding entries to the `"connectives"` section of `action-dictionary.json`.

### Semantic alias layer
`lib/semantic-aliases.json` holds canonical legal terms ("vulnerable populations", "employer", "employee", "residents") with per-language culturally preferred equivalents and a `plain_en` plain-language gloss. At module load, `ALIAS_ENTRIES` is built from the `aliases` array and sorted longest-first. `substituteAliases(obj, lang)` runs on `obj` before `substituteConnectives` — substitutes canonical legal terms with functional equivalents in the target language. Only modifies rendered output; `rawAction`, `fields.action`, and all ISC unit data are untouched. Add new aliases by appending to the `aliases` array in `semantic-aliases.json` — no renderer changes needed.

### English sentence and localized frame
`getLocalizedFrame` in `renderer.js` is the non-English render path. Key design decisions:

- **English sentence is the primary output** — the full English plain meaning sentence is generated first by the standard English path (TEMPLATES[lens]). It carries legal weight and is traceable to source.
- **Localized frame appended after em dash** — `getLocalizedFrame(modal, lang, actor)` looks up `modality_shift[requires|allows|prohibits][lang]` from `translations.json`, strips the action slot, and appends it after the English sentence. Format: `"The office of financial management must review and adjust compensation. — Qaybtan waxay u baahdaa (The office of financial management)."` The obligation speaks first; the localized posture label follows as classification in the reader's language.
- **Frame is modal-driven, not lens-driven** — `requires`/`allows`/`prohibits` is selected from `modal` signal regardless of which lens classified the sentence. All 7 non-English languages use the same lookup path.
- **Actor parenthetical** — actor strings ≤ 60 characters are appended to the frame in parentheses. The actor is a proper noun / entity name — omitting it loses traceability. Strings longer than 60 characters are silently dropped to prevent action-phrase contamination.
- **`noEnglishFallback` is retired** — every sentence now produces output (English + frame). There is no omission path for untranslatable content.
- **Repeal and appropriation are fully localized** — these section types have complete target-language templates in `translations.json` and do not use the frame-append model. They are rendered inline in `renderUnit` without `getLocalizedFrame`.
- **`translations.json` `section_type_prefixes.delayed`** has a `{date}` placeholder. Both `renderISC` and `renderISCLocalized` use `fillTemplate` to substitute the effective date.

### Compliance disclosure notice
A compliance disclosure notice is present in `legislation.html` above the search input. It states the tool is in active testing, discloses the deterministic pipeline methodology, and notes that output does not constitute legal advice. Do not remove this notice.

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
| `UPSTASH_REDIS_REST_URL` | Redis cache — optional, degrades gracefully if missing |
| `UPSTASH_REDIS_REST_TOKEN` | Redis cache — optional, degrades gracefully if missing |

No AI API keys are required or used. Redis failures are always silent (`try/catch` around every Redis call). The server starts and functions correctly without any environment variables set.

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
                                   NOTE: 404 handler registered inside registerHandlers().then()
                                   — must stay there to register after all API routes
render.yaml                      — Render deployment config
package.json                     — dependencies: express, @upstash/redis

api/
  health.js                      — GET  /api/health
  openapi.js                     — GET  /api/openapi (full OpenAPI 3.1 spec)
  plain-meaning.js               — POST /api/plain-meaning (deterministic, no AI)
  wa-bill-search.js              — GET  /api/wa-bill-search
  wa-bill-detail.js              — GET  /api/wa-bill-detail (has BILL_TYPE_RULES for routing)
  wa-bill-documents.js           — GET  /api/wa-bill-documents
  wa-bill-text.js                — GET  /api/wa-bill-text
                                   ALSO exports fetchBillTextData(billNumber, biennium) for direct use
  wa-bill-selection.js           — GET  /api/wa-bill-selection
                                   imports fetchBillTextData directly — no HTTP self-call
  wa-bill-plain-summary.js       — GET  /api/wa-bill-plain-summary (410 stub — replaced by /api/plain-meaning)
  analyze.js                     — POST /api/analyze (410 stub — replaced by /api/plain-meaning)

lib/
  plain-meaning/
    pipeline.js                  — 10-layer deterministic pipeline (runPipeline)
                                   includes pre-pipeline section type classification
    renderer.js                  — scope-lens template renderer (renderISC, renderUnit)
                                   renderISC(iscOutput, { lang }) accepts optional language code
                                   renderUnit(unit, lang) uses TRANSLATIONS for non-English output
                                   ALIAS_ENTRIES + substituteAliases — semantic alias pass (runs first)
                                   CONNECTIVE_ENTRIES + substituteConnectives — connective pass (runs second)
                                   both passes operate on obj string before dictionary lookup
  translations.json              — static multi-language templates; keys: lens names + per-modal variants + prefixes
                                   languages: es, vi, ru, uk, tl, so, ko
                                   placeholders: {actor}, {action}, {condition}, {deadline}, {amount}
                                   actor-based lenses use per-modal keys (must/may/cannot) — verb baked in, no {modal} placeholder
  action-dictionary.json         — verb and object phrase translations; also contains "connectives" section
                                   "connectives" section: multi-word connective phrases for substituteConnectives pass
  semantic-aliases.json          — canonical legal term → culturally preferred equivalent per language
                                   shape: { meta, aliases: [{ term, category, translations: { plain_en, es, vi, ru, uk, tl, so, ko } }] }
                                   extend by appending to aliases array — no renderer changes needed
  synonymMap.json                — termMap (word → RCW titles) + parentTerms (phrase → plain word)
  wa-adapter/
    index.js                     — WA Legislature API adapter (getNormalizedBill)
                                   calls fetchFromLiveApi directly — no local file candidates

data/
  wa/
    bill-index.json              — bill search index; run populate-bill-index.js to regenerate
    bill-corpus.json             — full bill text corpus for phrase scanning and validation;
                                   not present in repo by default — generated by build-bill-corpus.js workflow

index.html                       — dashboard home
legislation.html                 — bill reader (search, plain meaning, sections)
                                   uses makeBillTextPromise() to share one fetch across consumers
                                   Last Action field removed — redundant with Where Is This Bill Now
voting.html                      — voting resources
scripts/populate-bill-index.js   — build-time script; deterministic RCW taxonomy tagging, no AI
                                   must be run from a network-permitted environment (not Render)
scripts/build-bill-corpus.js     — one-time corpus builder; fetches full text for all 2,808 bills
                                   via fetchBillTextData, writes data/wa/bill-corpus.json.
                                   Run from GitHub Actions only — not from Render.
```
