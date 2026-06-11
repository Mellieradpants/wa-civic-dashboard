# WA Civic Dashboard — Full-System Read-Only Audit

**Scope:** Every stage from bill text ingestion (`wa-bill-text.js`) through the
10-layer pipeline (`pipeline.js`), the scope-lens renderer (`renderer.js`), all
`api/*` endpoints, `lib/wa-adapter`, `server.js`, the frontend assembly in
`legislation.html`, the test harness (`scripts/test-bills.js`), and the GitHub
Actions workflows. Read-only — no edits made.

Each finding is tagged with one of:
- **HANG** — execution can stall indefinitely with no bound
- **SILENT** — failure is swallowed with no log/no signal
- **WRONG** — output is incorrect but no error is raised
- **DROPPED** — data is lost/truncated/omitted with no logging

---

## 1. `api/wa-bill-text.js` — bill text ingestion

### 1.1 [WRONG] `extractBillNumber` doesn't strip RCW citations
`api/wa-bill-text.js:3-6`
```js
function extractBillNumber(text) {
  const match = String(text || "").match(/\b\d{3,4}\b/);
  return match ? match[0] : "";
}
```
The canonical implementation (`wa-bill-selection.js:3-8`) strips `RCW [\d.A-Za-z]+` citations first via `replace(/\bRCW\s+[\d.A-Za-z]+/gi, "")`. This file's copy lacks that strip entirely. A request like `?billNumber=RCW 70A.565.020` matches `"565"` from inside the citation and silently fetches the wrong bill — wrong output, no error.

### 1.2 [HANG] No timeout on WA Legislature fetches
`api/wa-bill-text.js:66-79` (`fetchBillHtml`)
```js
const searchRes = await fetch(searchUrl, { headers: { Accept: "text/html, */*" } });
...
const docRes = await fetch(docUrl, { headers: { Accept: "text/html, text/plain, */*" } });
```
Neither call has `AbortSignal.timeout(...)` or any other bound. If `app.leg.wa.gov` stalls, both `handler` and `fetchBillTextData` (and therefore `wa-bill-selection.js`, which calls `fetchBillTextData` directly) hang indefinitely with no fallback.

### 1.3 [DROPPED] Sections ≤ 20 chars silently dropped
`api/wa-bill-text.js:91-99`
```js
if (sectionText.length > 20) {
  sections.push({ id: ..., sectionNumber: ..., isNewSection, text: sectionText, characterCount: sectionText.length });
}
```
Any section whose trimmed text is ≤ 20 characters (e.g. `"Sec. 5. Repealed."`) is excluded from `sections` with no counter, no `droppedSections` field, and no `console.*` output anywhere in the file. `sectionCount` (line 163) silently undercounts.

### 1.4 [maintainability/duplication] `fetchBillTextData` and `handler` reimplement the same pipeline
`api/wa-bill-text.js:115-128` vs `:150-155`

Both blocks independently do: HTML fetch → `(( ))` strip → whitespace collapse → `trim()` → `splitIntoSections`. The `handler` does not call `fetchBillTextData`. A future fix to the `(( ))` regex (load-bearing per CLAUDE.md) made in only one place causes `/api/wa-bill-text` (HTTP) and `fetchBillTextData` callers (e.g. `wa-bill-selection.js`) to diverge silently.

### 1.5 [SILENT] `normalizeBiennium` falls back to "today's biennium" with no error
`api/wa-bill-text.js:8-23`, called at line 140
```js
function normalizeBiennium(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  if (/^\d{4}$/.test(text)) { ... }
  const now = new Date();
  const year = now.getUTCFullYear();
  const startYear = year % 2 === 0 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}
```
If `biennium`/`session`/`year` are missing or malformed (e.g. `"2025-2026"`, `"25-26"`), the function silently substitutes the **server's current-date-derived biennium** with no error field and no indication the requested value was ignored. The response's `biennium` field reflects the substituted value, masking the mismatch.

---

## 2. `lib/plain-meaning/pipeline.js` — 10-layer pipeline

### 2.1 [WRONG] `OBLIGATION_RE`/`MODAL_RE` mismatch on "obligated to"
`pipeline.js:48-49` vs `:89-90`
```js
const OBLIGATION_RE =
  /\bshall\b|\bmust\b|\brequired to\b|\bis required\b|\bare required\b|\bobligated to\b|.../i;
...
const MODAL_RE =
  /\b(is no longer required to|are no longer required to|is responsible for|are responsible for|are each repealed|is repealed|is(?:\s+hereby)?\s+appropriated|shall not|must not|may not|shall|must|may|cannot|is required to|are required to)\b/i;
```
`"obligated to"` is in `OBLIGATION_RE` but has no counterpart in `MODAL_RE`. A sentence like "The contractor is obligated to submit a report within 30 days" is detected as `signal === "obligation"` (so it survives `extractSignalSentences`), but `parseActorActionCondition`'s `norm.match(MODAL_RE)` (line 94) returns `null`, so `actor = null`, `modal = null`, `action = null`. The unit is built essentially empty — a real obligation silently produces no renderable content.

### 2.2 [DROPPED] `splitSentences` drops fragments ≤ 15 chars
`pipeline.js:60-65`
```js
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}
```
Any sentence/fragment of 15 characters or fewer (e.g. "No fee applies." = 15 chars exactly) is silently excluded from `extractSignalSentences` with no counter or log — short obligation/prohibition sentences near this boundary vanish entirely.

### 2.3 [WRONG] Sentence-split regex fractures abbreviations
`pipeline.js:62`
```js
.split(/(?<=[.!?])\s+(?=[A-Z("])/)
```
No abbreviation exception list. Text containing "U.S. Department of Health" splits at "U." and "S." (each followed by space + uppercase), producing fragments `"...the U."`, `"S."`, `"Department of Health..."`. None of these fragments match `OBLIGATION_RE`/`PROHIBITION_RE`/`PERMISSION_RE` correctly, and `parseActorActionCondition` operates on the fractured fragments rather than the intact sentence — silently corrupting actor/action extraction for any sentence referencing a multi-period abbreviation.

### 2.4 [WRONG/DROPPED] `detectSectionType`: repeal short-circuits before delayed-date check
`pipeline.js:237-250`
```js
function detectSectionType(text) {
  if (/\bNEW\s+SECTION\b/i.test(text)) return { type: "addition" };
  if (/\bis\s+amended\s+to\s+read\s+as\s+follows\b/i.test(text)) return { type: "amendment" };
  if (/\b(?:are\s+each\s+repealed|is\s+repealed)\b/i.test(text)) return { type: "repeal" };
  const effM = text.match(/\b(?:effective|takes?\s+effect)\s+([^.;\n]{0,60}?(?:January|...|December)\s+\d{1,2},?\s+\d{4})/i);
  if (effM) { ... return { type: "delayed", effectiveDate: ... }; }
  ...
}
```
For a section like "RCW 43.20.060 ... are each repealed, effective January 1, 2027.", line 240 returns `{ type: "repeal" }` immediately — the `effM` date extraction (lines 241-247) never runs. The `effectiveDate` is silently dropped: `renderUnit`'s repeal path (renderer.js:835-848) renders "...is no longer in effect" with no mention of the delayed date, and `renderISC`'s `delayed` prefix (renderer.js:992) never fires since `st.type !== "delayed"`.

---

## 3. `lib/plain-meaning/renderer.js` — scope-lens renderer

### 3.1 [WRONG] Cyrillic "З"/"С" homoglyph corruption — confirmed still live
`renderer.js:747-765`

Already fully documented in `PIPELINE_DEFECT_REPORT.md` Finding 1 (lines 33-72), including live reproduction. Confirmed unchanged at current line numbers: the lowercase Ukrainian "з" (line 753, U+0437) and Russian "с" (line 757, U+0441) prepositions prefix `{actor}`, get capitalized by `finalize()`, and produce "З The agency..."/"С The agency...". `scoreC6` only checks for "З" and misses the structurally identical "С" case.

### 3.2 [WRONG] `obligation_removal` lens regex misclassifies active removal-obligations
`renderer.js:26-30`
```js
const LENS_PATTERNS = [
  {
    lens: "obligation_removal",
    re: /\b(no longer required|not required|no obligation|removed\b|waived\b|exempted\b|no longer\s+\w+)\b/i,
  },
```
`obligation_removal` is checked first in `classifyLens` (first-match-wins). The bare `removed\b` alternative matches any sentence containing "removed" regardless of context. A sentence like "the contaminated soil must be removed by the property owner" — an ACTIVE obligation — matches `removed\b` and is classified as `obligation_removal`. The template (lines 303-325) then renders it as "{subject} is no longer required to {action}", inverting an active duty into a "requirement lifted" statement.

### 3.3 [DROPPED] `actor_power_shift` template never appends `firstDeadline`
`renderer.js:218-234`
```js
actor_power_shift({ actor, action, conditions }) {
    if (!actor) return null;
    const subject = cleanActor(actor);
    const rawAct = cleanAction(action);
    const act = rawAct?.replace(/^be\s+responsible\s+for\s+/i, "").replace(/^responsible\s+for\s+/i, "").trim() || null;
    if (!act) return null;
    let s = `${subject} is responsible for ${act}`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    return s;
  },
```
`deadlines` is not destructured and `firstDeadline` is never called — unlike `modality_shift` (213-214), `scope_change` (246-247), and `action_domain_shift` (289-301), all of which append a `dl` segment. Any unit classified `actor_power_shift` with a non-empty `fields.deadlines` (e.g. "The director is responsible for reviewing applications within 30 days") silently drops the "within 30 days" deadline.

### 3.4 [DROPPED] `alreadyPresent`'s 18-char-prefix heuristic causes false-positive suppression
`renderer.js:192-195`
```js
function alreadyPresent(sentence, phrase) {
  if (!phrase) return true;
  return sentence.toLowerCase().includes(phrase.toLowerCase().slice(0, 18));
}
```
Used at lines 212, 214, 232, 245, 247, 285, 297, 299, 318, 322. Two distinct conditions/deadlines sharing an 18-character prefix (e.g. both starting "if the department ...") are treated as duplicates — if the sentence already contains the first, `alreadyPresent` returns `true` for the second even though its substantive tail was never appended, silently dropping a distinct condition.

### 3.5 [WRONG] `splitCompoundAction` includes "will" but `modalVerb` has no "will" case → defaults to "must"
`renderer.js:801-811` and `:63-85`
```js
function splitCompoundAction(actionStr) {
  ...
  const m = /\band\s+(must\s+not|shall\s+not|may\s+not|cannot|must|shall|may|will)\b/i.exec(actionStr);
  ...
  return { action1: ..., newModalStr: m[1]..., action2: ... };
}
```
```js
function modalVerb(modal, signal) {
  const m = String(modal || signal || "").toLowerCase();
  if (m.includes("shall not") || m.includes("must not") || m.includes("may not") || m === "cannot" || signal === "prohibition") return "cannot";
  if (signal === "obligation") return "must";
  if (m === "may" || m.includes("permitted") || m.includes("authorized") || signal === "permission") return "may";
  return "must";
}
```
`splitCompoundAction` matches `"and will"` and produces `newModalStr: "will"`. `modalVerb("will", null)` matches none of the explicit branches and falls through to `return "must"` (line 84). A clause like "...and will receive notification" — non-binding future tense — is rendered as an obligation ("X must receive notification"), inverting the meaning with no error.

### 3.6 [SILENT/DROPPED] Multiple silent null-sentence paths drop entire obligations from output
`renderer.js` — multiple return points:
- Line 760: `if (!actor) return { sentence: null, missingTokens };` (uk/ru "cannot" fee-frame branch, 747-765) — falsy `actor` drops the whole clause.
- Line 779: `if (!tmpl) return { sentence: null, missingTokens };` — missing `TRANSLATIONS[lens]?.[subKey]?.[lang]` combination drops silently with no log of which lens/subKey/lang triplet was missing.
- Lines 781-784: required `{action}`/`{actor}` placeholder has no value → `return { sentence: null, missingTokens }`.
- Line 936: `sentence = finalize(raw) || plainify(unit.tetherAnchor?.anchorText);` — only the English non-split path has a `plainify` fallback; the localized path (928-933) and split-compound path (905-927) have none, so `sentence` can remain `null`.
- `renderISC` lines 975-980: `.filter((r) => { if (!r.sentence) return false; ... })` — any unit with `sentence: null` is silently dropped from `rendered`, with no counter of dropped-vs-rendered units. An entire obligation can vanish from `plainMeaning` with zero trace; only `rendered.length` indirectly affects the `noObligationMsg` fallback (line 1010).

### 3.7 [WRONG, low-impact] `isLocalized: true` possible on a null-sentence unit
`renderer.js:952-963`, aggregated at `:1017`
```js
return {
    sourceLocation: ..., lens, signal, sectionType: sectionType.type, sentence,
    missingSignals: ..., controlFlags: ..., status: ...,
    missingTokens: missingTokens || null,
    isLocalized: missingTokens === null,
  };
```
`isLocalized` is computed solely from `missingTokens === null`, independent of `sentence`. A unit can have `sentence: null, isLocalized: true` (e.g. via the line-779 `if (!tmpl)` path where `missingTokens` was never set). **Practical impact: minimal** — `renderISC`'s filter (line 976, `if (!r.sentence) return false;`) excludes such units from `rendered` before the aggregate `rendered.every(r => r.isLocalized)` (line 1017) runs, and a codebase-wide grep shows the per-unit `isLocalized` field is never consumed elsewhere.

---

## 4. Other `api/*` endpoints and `lib/wa-adapter`

### 4.1 [HANG] No timeout on WA Legislature fetches across multiple handlers
- `api/wa-bill-detail.js:168, 211` — `fetchBillSummaryPage`'s primary XML fetch and HTML fallback fetch, both unbounded. A stalled `wslwebservices.leg.wa.gov`/`app.leg.wa.gov` hangs `/api/wa-bill-detail` (and any caller, including `lib/wa-adapter/index.js`) indefinitely — even the fallback path can hang.
- `api/wa-bill-documents.js:191` — `fetch(documentSearchUrl, ...)`, same issue.
- `api/wa-bill-search.js:291` (`lookupOfficialBillByNumber`) — unbounded fetch awaited synchronously inside the main handler (line 412); a hung official lookup blocks the entire `/api/wa-bill-search` response even though local-index results were already computed.

### 4.2 [HANG/WRONG] `lib/wa-adapter/index.js:15` uses a relative URL with Node `fetch`
```js
const res = await fetch(apiUrl, { cache: "no-store" }); // apiUrl = "/api/wa-bill-detail?..."
```
In a server-side Node context, `fetch` with a relative URL throws `TypeError: Failed to parse URL` synchronously — uncaught anywhere in this file, propagating up. In a browser context it resolves fine but inherits no timeout, compounding 4.1's hang risk in `wa-bill-detail.js`.

### 4.3 [SILENT] JSON body parse failure masked as "no body"
`api/plain-meaning.js:21-27` and `api/translate-selection.js:20-26` — if `req.body` is a string and `JSON.parse` throws, `body` is silently set to `{}` with no logging. The subsequent `!text && !units` check returns a generic 400 "Provide text or units", masking "malformed JSON" vs. "empty request" as the same error.

### 4.4 [SILENT] `wa-bill-search.js` error handler drops diagnostic info
`api/wa-bill-search.js:434-438` — catch-all returns `{ message: error.message }` only — no `error` field (unlike `wa-bill-detail.js`/`wa-bill-documents.js`/`wa-bill-selection.js`, which include both), no `console.error`, stack trace discarded. Any unexpected exception (bill-index parse failure, synonymMap issue) produces a 500 with minimal diagnostics and zero server log trace.

### 4.5 [SILENT] Health checks never log server-side
`api/health.js:24-26, 35-37` — both health checks catch errors into `{ status: "error"/"unreachable", error: err.message }` in the response, but never `console.error`. If nobody polls `/api/health`, a persistent bill-index load failure or WA Leg API outage produces no operational signal.

### 4.6 [SILENT] `/api/missing-token` swallows the actual Redis error
`api/missing-token.js:26-28` — `catch { return res.status(500)... }` discards `error.message` entirely and logs nothing. Caller gets a generic "Could not read missing tokens log" with zero diagnostic info.

### 4.7 [SILENT] Possible Redis env-var name mismatch between seed script and reader
`scripts/seed-missing-tokens.js:16-17, 22` uses `KV_REST_API_URL`/`KV_REST_API_TOKEN`, while `api/missing-token.js` and `pipeline.js`'s `logIfMissing` use `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`. If both names are configured to different Redis instances in Render, `/api/missing-token` would silently report `count: 0` even though entries exist (or the seed script writes to a different store than the pipeline reads from).

### 4.8 [SILENT] `wa-adapter`'s `.json().catch(() => ({}))` masks malformed bodies
`lib/wa-adapter/index.js:16` — `const data = await res.json().catch(() => ({}))`. A non-2xx response with a non-JSON body (e.g. an HTML 502 page) becomes `{}`, then line 18's `if (!res.ok)` throws using `data.message || "unknown error"` (masks the real body). A 2xx response with malformed JSON also becomes `{}`, then line 24 (`if (!data.title)`) throws "No bill data returned" — masking "bad JSON" as "no data".

### 4.9 [SILENT] `wa-bill-detail.js` doesn't log when XML primary path fails but HTML fallback succeeds
`api/wa-bill-detail.js:210-251` — outer `catch (xmlError)` swallows the original XML error if the HTML fallback succeeds, with no logging of `xmlError` even on fallback success. The primary SOAP/XML endpoint could be degrading for every request with no operational visibility unless the fallback also fails.

### 4.10 [WRONG] `wa-bill-detail.js` hardcodes `displayNumber: "HB/SB ${billNumber}"` regardless of bill type
`api/wa-bill-detail.js:190, 218` — does not import/apply `BILL_TYPE_RULES` (unlike `wa-bill-documents.js`/`wa-bill-selection.js`, which each have their own copy). For bills outside 1000-3999/5000-7999 (HJM, HJR, HCR, HR, SJM, SJR, SCR, SR, SGA per CLAUDE.md), the returned `displayNumber` is wrong with no error.

### 4.11 [WRONG] `wa-bill-detail.js`'s `stripPrefix` doesn't strip RCW citations either
`api/wa-bill-detail.js:18` — strips a chamber prefix then does `.replace(/[^0-9]/g, "")` on the entire remaining string — no RCW-citation strip. `"RCW 70A.565.020"` → `"70565020"` (concatenation of all digits), a nonsensical bill number passed silently to the WA Legislature API (404 or wrong bill, status 200, no error).

### 4.12 [WRONG] `wa-bill-documents.js`'s `extractBillNumber` has the same RCW-stripping gap
`api/wa-bill-documents.js:18` — `String(text || "").match(/\b\d{3,4}\b/)`, no RCW strip. `"RCW 70A.565.020"` → matches `"565"` — same documented failure mode as `wa-bill-text.js` (1.1), undocumented for this file.

### 4.13 [WRONG] Category-only search matches indistinguishable from keyword matches
`api/wa-bill-search.js:392-395, 409`
```js
const titleMatch = rcwTitleFilter.size > 0 && (record.rcw_titles || []).some((t) => rcwTitleFilter.has(t));
return { record, score: titleMatch && score === 0 ? 1 : score, titleMatch };
```
A bill with `score === 0` but a matching `rcw_titles` category gets `score: 1` and passes `.filter(entry => entry.score > 0)` — i.e. it can appear in results purely on category overlap, with none of the query words present. `titleMatch` is dropped in the final `.map(({ record }) => mapRecord(record))` (line 409), so the API consumer cannot distinguish a real keyword match from a category-only match.

### 4.14 [WRONG/dead data] `rawSample` returns the same record on every search response
`api/wa-bill-search.js:427` — `rawSample: billIndex[0] || null` returns the first record of the entire 2,808-bill index regardless of query — looks like leftover debug output, not query-relevant, could be mistaken for a relevant result by a consumer.

### 4.15 [WRONG] Session filter uses substring match, not exact match
`api/wa-bill-search.js:399-401`
```js
if (!session) return true;
return String(entry.record.session || "").includes(session) || String(entry.record.session || "").includes(biennium);
```
`session` is raw user input (e.g. `"2025"`); `String(record.session).includes("2025")` would also match a hypothetical `"1925-26"` or any session string containing that substring — low likelihood given current data shapes, but a substring-vs-equality looseness.

### 4.16 [WRONG] Official bill-number lookup unconditionally placed first in results
`api/wa-bill-search.js:411-418` — `officialResult` (live WA Legislature lookup) is always prepended to `results` whenever the query parses as containing a bill number, regardless of relevance score. A keyword query that incidentally contains a 3-4 digit number (e.g. "the 1234 program") forces an unrelated official bill lookup to the top of results ahead of genuinely relevant matches.

### 4.17 [WRONG] `status` field can silently differ from `currentStatus.status`
`api/wa-bill-detail.js:198` — `status: parsed.currentStatus?.status || parsed.currentStatus?.historyLine || null`. If `currentStatus.status` is `""` (empty but present, as the WA XML API sometimes returns for in-progress bills), `status` falls through to `historyLine` while `currentStatus.status` remains `""` — a consumer reading both fields sees inconsistent values with no error.

### 4.18 [DROPPED] Double `.slice(0, 10)` truncation can drop a relevant local result
`api/wa-bill-search.js:409, 418` — `localResults` is sliced to 10 (line 408), then the merged+deduped `results` (officialResult + localResults) is sliced to 10 again (line 418). When `officialResult` is non-null and not a duplicate, the 11-item merged list re-sliced to 10 silently drops the last local result — unlogged double-truncation.

### 4.19 [DROPPED] `mapRecord` omits `categories`, `rcw_titles`, `keywords` from API responses
`api/wa-bill-search.js:253-280` — these index fields (documented in CLAUDE.md as present on index records, and `rcw_titles` is used internally for `titleMatch` scoring at line 394) are never surfaced to API consumers — a frontend can't show *why* a bill matched or filter further client-side.

### 4.20 [DROPPED] Truncated excerpts with no truncation indicator
- `api/wa-bill-detail.js:207` — `raw_xml_excerpt: xml.slice(0, 1200)`, no `truncated`/total-length flag.
- `api/wa-bill-documents.js:147` — `source_context: context.slice(0, 700)`, same — lower-stakes by design but still unflagged.

### 4.21 [DROPPED] Inconsistent partial-data shape in `wa-bill-detail.js` HTML fallback
`api/wa-bill-detail.js:227-236` — `currentStatus` is built only if `scraped.historyLine` is truthy; if the HTML scrape found `sponsor`/`introducedDate` but no `historyLine`, those fields are still returned at the top level while `currentStatus` is `null` — an inconsistent shape a consumer expecting `currentStatus` whenever `sponsor`/`introducedDate` are present would mishandle, with no error.

---

## 5. `legislation.html` — frontend assembly

### 5.1 [HANG] Race condition on rapid bill switching — no cancellation/generation guard
`legislation.html` — `loadSelectedBill` (1247-1276), `fetchPlainMeaning` (743-776), `fetchTranslation` (782-811), `loadBillText` (1176-1206), `loadBillPlainSummary` (1208-1245)

None of these functions take or check a cancellation token, generation counter, or `AbortController`. No module-level "current request id" exists (only `englishSummary`, `lastSectionUnits`, `summaryBillNum`, `summaryBiennium`, `translationCache`, none of which serve as a guard). If a user selects Bill A then immediately Bill B before Bill A's async chains resolve, both write directly to shared DOM elements (`billSectionsList`, `billDocPlainSummary`, `billSectionsSummary`, etc.). Whichever response resolves last wins — Bill A's stale data can overwrite Bill B's freshly-loaded UI.

### 5.2 [HANG] Unawaited, untimed section-interpretation fetch in `loadBillText`
`legislation.html:1196-1200`
```js
fetch(selectionPath, { cache: "no-store" })
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d) renderSectionInterpretations(d); })
  .catch(() => {});
```
Not awaited, no `AbortController`/timeout. If `/api/wa-bill-selection` hangs, this never resolves; `loadBillText` completes normally but section panels permanently show no interpretation text with no indication a request is still in flight. If the user has switched bills by the time it resolves, it can attach stale-bill interpretation data onto whatever cards are currently in the DOM (no staleness guard, ties into 5.1).

### 5.3 [HANG] No AbortController/timeout on any other fetch in the file
`legislation.html:1135, 1170, 1188-1191, 1222-1223, 1267, 1318` — `loadBillDocuments`, `makeBillTextPromise`, `loadBillText`, `loadBillPlainSummary`, the `getNormalizedBill`/`/api/wa-bill-detail` call, and `runSearch`. A hung backend endpoint leaves the corresponding UI section stuck on its "Loading..." placeholder (e.g. "Loading official document links...", "Loading raw sections...", "Extracting plain meaning…") indefinitely with no fallback message.

### 5.4 [SILENT] Empty `.catch(() => {})` on the section-interpretation fetch
`legislation.html:1199` — no `console.error`, no UI update on failure. A 500/network error from `/api/wa-bill-selection` is indistinguishable from "no interpretation data exists for this bill."

### 5.5 [SILENT] Non-OK responses converted to `null` and silently ignored
`legislation.html:1197` — `.then(r => r.ok ? r.json() : null)` then `.then(d => { if (d) renderSectionInterpretations(d); })`. Combined with 5.4, there's no distinguishable signal between "endpoint returned 404/500" and "endpoint returned valid empty data."

### 5.6 [WRONG] `[!]` English-fallback marker injected into localized output
`legislation.html:869-871`
```js
if (!result.isLocalized) {
  displayText += "\n\n[!] Some action phrases remain in English. Dictionary entries are being added.";
}
```
Whenever any section's `isLocalized === false` (per renderer.js 3.7's aggregate), this hardcoded English-only string is appended to the cached/displayed translation (`translationCache[lang]`, `billDocPlainSummary.textContent`) — an English disclosure string embedded inside otherwise-localized text.

### 5.7 [WRONG/SILENT] Hardcoded fallback values mask missing data
- **Biennium `"2025-26"` fallback** — `buildDetailPath` (909), `buildDocumentPath` (916), `buildTextPath` (923), `buildSelectionPath` (1022), `loadBillPlainSummary` (1210): `const biennium = record.session || "2025-26";`. If `record.session` is missing, every API path for that bill silently targets the `2025-26` biennium regardless of the bill's actual session.
- **`getBillType` returns `""`** (928-933) for any bill ID prefix outside HB/SB patterns (resolutions, memorials, etc. per `BILL_TYPE_RULES`) — silently omits the bill-type label for those record types.
- **`translateStatus` raw passthrough** (935-944, `return rawStatus;` at 943) — unmatched status strings are shown verbatim (raw legal jargon) with no indication this is an untranslated fallback.
- **`"Untitled"` fallback** (891) — bills with no title display literally "Untitled" with no further context.

### 5.8 [WRONG] `renderDocumentLinks` keeps only the first document per `file_type`
`legislation.html:1098-1106` — if the API returns multiple documents of the same `file_type` (the code's own comment acknowledges this can happen — one per bill section), only the first is shown. For a multi-section bill with one "Bill Text" PDF per section, the user can only ever open the first section's text link — no error, no truncation notice.

### 5.9 [DROPPED] Same-type documents beyond the first silently discarded
`legislation.html:1100-1106` — same location as 5.8, listed separately as a data-drop: `allDocuments.length` vs `documents.length` is never compared/logged. A bill with 5 same-`file_type` documents loses 4 with zero record anywhere.

### 5.10 [WRONG] Stale `card` reference risk in `openSectionPanel`
`legislation.html:1147` — `card.querySelector(".section-title")?.textContent || ""` reads from a DOM reference captured in the `.forEach` closure at line 1011 when sections were last rendered. If `billSectionsList.innerHTML = ""` has since run (a new bill loaded) before the click handler fires, the captured `card` reference is stale — low-probability race, ties into 5.1.

### 5.11 [WRONG] No shape check on `getNormalizedBill` result before use
`legislation.html:1267-1268`
```js
const normalized = await getNormalizedBill(biennium, billNum);
const detail = normalized.raw;
```
No null/shape check. If `getNormalizedBill` resolves successfully but without a `.raw` property, `detail` becomes `undefined`; `renderBillFromRecord`/`loadBillDocuments` proceed with `detail = undefined`, all `detail?.xxx` chains fall back to `record` fields, and the success message **"Loaded official detail for ${label}."** (line 1271) is shown even though no live-API detail was actually loaded.

### 5.12 [DROPPED] Rule/unit entries with unmatched `sectionId` silently dropped
`legislation.html:1077-1084` (`renderSectionInterpretations`) — `unitsBySectionId`/`rulesBySectionId` are grouped by `sectionId` from `/api/wa-bill-selection`'s response, then only iterated via `querySelectorAll("[data-section-id]")` over currently-rendered cards. If `/api/wa-bill-text` and `/api/wa-bill-selection` produce different section-ID schemes for the same bill, entries with no matching card are silently dropped — no log of orphaned interpretation data.

### 5.13 [DROPPED] `interpretSectionNodes` truncates definition/reference units
`legislation.html:1059-1062` — `.slice(0, 1)` for definition units and `.slice(0, 2)` for reference/exception units. Additional matching units beyond these caps are dropped with no "+N more" indicator and no log.

### 5.14 [DROPPED] Missing `sectionTypes` entries leave badges silently hidden
`legislation.html:1232-1233` — `if (sectionTypes.length) applySectionTypeBadges(sectionTypes);`. If `fetchPlainMeaning` returns fewer `sectionTypes` entries than `sections.length` (some sections skipped internally), `applySectionTypeBadges` leaves those sections' badges `hidden = true` (line 1005) with no log explaining the discrepancy to a reader of the UI.

---

## 6. `server.js`

No new HANG/SILENT/WRONG/DROPPED findings beyond what's covered by the API-handler section above — the documented pattern (404 handler registered inside `registerHandlers().then()`, after all API routes) is implemented as described in CLAUDE.md and was confirmed correct.

---

## 7. Test harness (`scripts/test-bills.js`) and CI workflows

### 7.1 [HANG] `run-tests.yml` job has no overall `timeout-minutes`
`.github/workflows/run-tests.yml:27` (`node server.js &`) — no PID capture beyond the readiness-poll step (29-38), and no job-level `timeout-minutes` (contrast `build-bill-corpus.yml:9`, which has `timeout-minutes: 30`). If the server starts successfully but `test-bills.js` itself stalls mid-run (e.g. a pathological input causes an infinite loop in the pipeline/renderer), the job runs until GitHub's default 360-minute limit.

### 7.2 [HANG] No per-request timeout in `test-bills.js`
`scripts/test-bills.js:24-38` (`getJSON`/`postJSON`) — bare `fetch`, no `AbortController`/timeout. The double loop in `testBill` (140-155, sections × 7 languages × translate-selection POST) runs via `Promise.all` per batch (line 186) — one hung request stalls the entire batch and the whole script, with no script-level timeout either.

### 7.3 [unhandled failure mode, not a hang] `run-tests.yml` push has no rebase/retry
`.github/workflows/run-tests.yml:48-49` — `git diff --staged --quiet || git commit ...` then `git push origin HEAD:main` with no `git pull --rebase origin main` first (contrast `build-bill-corpus.yml:29`, which does rebase). If `main` has moved since checkout (concurrent run or human push), the push fails with a non-fast-forward error and no retry. `populate-bill-index.yml:30` has the same gap.

### 7.4 [SILENT] Bills that fail `/api/wa-bill-text` vanish from results entirely
`scripts/test-bills.js:112-115, 187-189` — a bill is logged `SKIP` to console and `testBill` returns `null`; `null` results are filtered from `run.bills` (188-189) with no placeholder. `test-results.json` records only successfully-tested bills — a reviewer can't tell from the JSON alone that fewer than the intended 25 bills were scored.

### 7.5 [SILENT] Per-section `/api/plain-meaning` failures indistinguishable from "no obligations"
`scripts/test-bills.js:129-132` — a failed section is recorded as `units: [], hasContent: false, plainMeaning: ""`, contributes zero to `enSectionsWithContent`/`enCombined`, and is `continue`'d for every language's translation pass (line 145, `if (!sec.units.length) continue;`). The failure is `console.log`'d as `WARN` but not recorded in `test-results.json` — indistinguishable from a section that legitimately produced no obligations.

### 7.6 [SILENT] Per-language `/api/translate-selection` failures only logged to console
`scripts/test-bills.js:152-154` — same pattern: `WARN`-logged, otherwise ignored, no trace in `test-results.json`. A systemic translation-endpoint outage for one language across an entire bill manifests only as C7 count-mismatch failures, not as an explicit "N requests failed" record.

### 7.7 [SILENT] Server stdout/stderr not captured or checked
`.github/workflows/run-tests.yml` — the backgrounded server's logs are interleaved into the job log but never checked for error-level lines after the run; no `actions/upload-artifact` step persists them. Caught exceptions during the test run (Redis errors, pipeline exceptions) leave no isolated failure signal.

### 7.8 [WRONG] C7 baseline (`enSectionsWithContent`) computed with different "hasContent" semantics than the per-language loop
`scripts/test-bills.js:135` (baseline) vs `:145` (`if (!sec.units.length) continue;`), used at line 161 (`scoreC7`)

`enSectionsWithContent` counts sections where `r.hasContent` (from `/api/plain-meaning`, which can be `true` for repeal sections via `renderer.js:1016`'s repeal short-circuit even with empty `units`). The per-language loop skips any section with `units.length === 0` regardless of `hasContent`. A repeal section with `hasContent: true, units: []` counts toward the English baseline but is skipped for every language — guaranteeing every language fails C7 by a fixed offset for that bill, unrelated to translation quality.

### 7.9 [WRONG] C6 "full duplication" check operates at a different scope than the renderer's own dedup
`scripts/test-bills.js:66-89` (`scoreC6`), `combined` built at lines 141/150 vs `renderer.js:974-980` (`renderISC`'s `seen` Set)

`scoreC6` checks for duplicate paragraphs across the **whole-bill** concatenation (`combined`, all sections joined) using one `Set` for the entire bill. The renderer's own dedup (`renderISC`'s `seen`) is scoped **per call** — i.e. per section, since `translate-selection.js:41` calls `renderISC({ units }, { lang })` once per section. The renderer never dedupes across sections by design. Consequence: two sections that legitimately render the same static boilerplate (`noObligationMsg`, renderer.js:998-1000, or `repealMsg`, renderer.js:1002-1004 — both per-language static strings reused verbatim for any no-content/repeal section) produce two identical paragraphs in `combined` and trigger a **false-positive "Full duplication" C6 failure** in the harness, even though this is expected/correct rendering behavior unrelated to the Cyrillic-artifact bug C6 is meant to catch. The harness's C6 is strictly broader than what the renderer does or is designed to do — it cannot be "fixed" by changing renderer-side dedup, since the two checks operate at different scopes entirely.

### 7.10 [WRONG/coverage gap] Fixed, non-random 25-bill sample
`data/wa/test-bills.json` — a static hardcoded array of 25 bill numbers (2398, 1667, 2678, ..., 9117). No randomization, re-sampling, or rotation in `test-bills.js` or `run-tests.yml` (which is `workflow_dispatch`-only, no schedule). The same 25 bills are tested every run — this harness is a fixed 25-bill smoke test, not a sample of the 338-bill validation corpus referenced in CLAUDE.md. Any pipeline regression not manifesting in these specific 25 bills' specific sections is never caught, with no indication of this narrow coverage anywhere in `test-results.json`.

### 7.11 [DROPPED] Empty/whitespace-only sections filtered before testing, uncounted
`scripts/test-bills.js:117` — `const sections = (textData?.sections || []).filter(s => s.text?.trim());`. No count of filtered sections is logged or recorded. If `wa-bill-text` returns sections with empty text due to an upstream regression (e.g. a markup-stripping bug that empties a section), this filter masks it — the bill can show "PASS" while silently testing fewer sections than it actually has.

### 7.12 [DROPPED] `test-results.json` grows unboundedly with no diffing/regression detection
`scripts/test-bills.js:196-197` — every run appends to `runs[]` (8 runs currently present) with no cap, rotation, or diff logic between runs to detect regressions/drift.

### 7.13 [context, dormant] `translate-dictionary.yml.disabled` references an external Google Translate API
`.github/workflows/translate-dictionary.yml.disabled:20-24` — invokes `node scripts/translate-dictionary.js` with `GOOGLE_TRANSLATE_API_KEY`. The file is disabled (`.yml.disabled`), so it does not currently violate the "no external AI/API at runtime" rule, but its presence — undocumented in CLAUDE.md, which describes static-template-only translation — is flagged per the audit's instruction to surface contradictions, even though it's dormant.

---

## Summary table

| § | File | Lines | Category |
|---|------|-------|----------|
| 1.1 | api/wa-bill-text.js | 3-6 | WRONG |
| 1.2 | api/wa-bill-text.js | 66-79 | HANG |
| 1.3 | api/wa-bill-text.js | 91-99 | DROPPED |
| 1.4 | api/wa-bill-text.js | 115-128, 150-155 | duplication |
| 1.5 | api/wa-bill-text.js | 8-23, 140 | SILENT |
| 2.1 | lib/plain-meaning/pipeline.js | 48-49, 89-90 | WRONG |
| 2.2 | lib/plain-meaning/pipeline.js | 60-65 | DROPPED |
| 2.3 | lib/plain-meaning/pipeline.js | 62 | WRONG |
| 2.4 | lib/plain-meaning/pipeline.js | 237-250 | WRONG/DROPPED |
| 3.1 | lib/plain-meaning/renderer.js | 747-765 | WRONG (already documented) |
| 3.2 | lib/plain-meaning/renderer.js | 26-30 | WRONG |
| 3.3 | lib/plain-meaning/renderer.js | 218-234 | DROPPED |
| 3.4 | lib/plain-meaning/renderer.js | 192-195 | DROPPED |
| 3.5 | lib/plain-meaning/renderer.js | 801-811, 63-85 | WRONG |
| 3.6 | lib/plain-meaning/renderer.js | 760, 779, 781-784, 936, 975-980 | SILENT/DROPPED |
| 3.7 | lib/plain-meaning/renderer.js | 952-963, 1017 | WRONG (low impact) |
| 4.1 | api/wa-bill-detail.js, wa-bill-documents.js, wa-bill-search.js | 168/211, 191, 291 | HANG |
| 4.2 | lib/wa-adapter/index.js | 15 | HANG/WRONG |
| 4.3 | api/plain-meaning.js, translate-selection.js | 21-27, 20-26 | SILENT |
| 4.4 | api/wa-bill-search.js | 434-438 | SILENT |
| 4.5 | api/health.js | 24-26, 35-37 | SILENT |
| 4.6 | api/missing-token.js | 26-28 | SILENT |
| 4.7 | scripts/seed-missing-tokens.js | 16-17, 22 | SILENT |
| 4.8 | lib/wa-adapter/index.js | 16 | SILENT |
| 4.9 | api/wa-bill-detail.js | 210-251 | SILENT |
| 4.10 | api/wa-bill-detail.js | 190, 218 | WRONG |
| 4.11 | api/wa-bill-detail.js | 18 | WRONG |
| 4.12 | api/wa-bill-documents.js | 18 | WRONG |
| 4.13 | api/wa-bill-search.js | 392-395, 409 | WRONG |
| 4.14 | api/wa-bill-search.js | 427 | WRONG/dead data |
| 4.15 | api/wa-bill-search.js | 399-401 | WRONG |
| 4.16 | api/wa-bill-search.js | 411-418 | WRONG |
| 4.17 | api/wa-bill-detail.js | 198 | WRONG |
| 4.18 | api/wa-bill-search.js | 409, 418 | DROPPED |
| 4.19 | api/wa-bill-search.js | 253-280 | DROPPED |
| 4.20 | api/wa-bill-detail.js, wa-bill-documents.js | 207, 147 | DROPPED |
| 4.21 | api/wa-bill-detail.js | 227-236 | DROPPED |
| 5.1 | legislation.html | 743-811, 1176-1276 | HANG (race) |
| 5.2 | legislation.html | 1196-1200 | HANG |
| 5.3 | legislation.html | 1135, 1170, 1188-1191, 1222-1223, 1267, 1318 | HANG |
| 5.4 | legislation.html | 1199 | SILENT |
| 5.5 | legislation.html | 1197 | SILENT |
| 5.6 | legislation.html | 869-871 | WRONG |
| 5.7 | legislation.html | 909/916/923/1022/1210, 928-933, 935-944, 891 | WRONG/SILENT |
| 5.8 | legislation.html | 1098-1106 | WRONG |
| 5.9 | legislation.html | 1100-1106 | DROPPED |
| 5.10 | legislation.html | 1147 | WRONG |
| 5.11 | legislation.html | 1267-1268 | WRONG |
| 5.12 | legislation.html | 1077-1084 | DROPPED |
| 5.13 | legislation.html | 1059-1062 | DROPPED |
| 5.14 | legislation.html | 1232-1233 | DROPPED |
| 7.1 | .github/workflows/run-tests.yml | 27 | HANG |
| 7.2 | scripts/test-bills.js | 24-38, 140-155, 186 | HANG |
| 7.3 | .github/workflows/run-tests.yml | 48-49 | unhandled failure |
| 7.4 | scripts/test-bills.js | 112-115, 187-189 | SILENT |
| 7.5 | scripts/test-bills.js | 129-132, 145 | SILENT |
| 7.6 | scripts/test-bills.js | 152-154 | SILENT |
| 7.7 | .github/workflows/run-tests.yml | (whole file) | SILENT |
| 7.8 | scripts/test-bills.js | 135, 145, 161 | WRONG |
| 7.9 | scripts/test-bills.js | 66-89, 141, 150 | WRONG |
| 7.10 | data/wa/test-bills.json | (whole file) | WRONG/coverage |
| 7.11 | scripts/test-bills.js | 117 | DROPPED |
| 7.12 | scripts/test-bills.js | 196-197 | DROPPED |
| 7.13 | .github/workflows/translate-dictionary.yml.disabled | 20-24 | dormant/contradiction |
