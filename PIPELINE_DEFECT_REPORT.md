# WA Civic Dashboard — Pipeline Defect Investigation

**Scope:** Read-only end-to-end audit of the plain-meaning pipeline, from text
extraction (`wa-bill-text.js`) through the 10-layer pipeline (`pipeline.js`) and
scope-lens renderer (`renderer.js`) to final localized output. No code was
changed. This reports **additional** defects beyond the three already known to
the team (recapped below for context).

**Branch / state audited:** `main` tip, including commit `a6a6b2c` ("Stop
shipping garbled localized sentences when action translation partially fails").

**How findings were verified:** Reproduced live against a locally running server
(`/api/plain-meaning` → `/api/translate-selection`), against the renderer
modules directly, and statistically against the 2,808-bill corpus
(`data/wa/bill-corpus.json`). The latest test run (2026-06-07T15:50) shows 35
failures / 700 checks (95% pass) across 5 bills: 2398, 1092, 1433, 5890, 9117
(C6), plus 6 bills with the Cyrillic-"З" C6 failure, and 9117 (C1).

---

## Already-known defects (for context — NOT re-investigated)

- **Defect A** — *Fixed.* `missingTokens` guard added in `renderClause` and the
  single-clause localized path (`a6a6b2c`). See Finding 1 for why this fix is
  incomplete.
- **Defect B** — Subsection-marker stripping upstream incorrectly removes
  substantive cross-references like "(b)" (seen in Bill 5890).
- **Defect C** — C6 duplication check can't distinguish legitimately repeated
  law text from garbled output appearing twice.

---

## Finding 1 — `З`/`С` stray-Cyrillic corruption is still LIVE; the `a6a6b2c` fix covers only half the cases

**Severity: High. Reproduced live on current `main`. Half the failure surface is invisible to the test suite.**

### Reproduction (current `main`, server running)
```
POST /api/plain-meaning      {"text": "The agency cannot impose impact fee."}
POST /api/translate-selection {lang:"uk"} → "З The agency не справляється нав'язати плата за вплив."   (isLocalized: true)
POST /api/translate-selection {lang:"ru"} → "С The agency не взимается навязывать плата за воздействие." (isLocalized: true)
```

### Root cause
`renderer.js:753` and `:757` hold the **only two templates in the system that
intentionally begin with a lowercase letter**:
- Ukrainian `"з {actor} не справляється {action}"` — "з" = U+0437, preposition "from/with"
- Russian `"с {actor} не взимается {action}"` — "с" = U+0441, preposition "with/from"

These fire for the `cannot` + fee/charge frame (`renderer.js:747-759`).
`finalize()` (`renderer.js:330-335`) unconditionally upper-cases the first
character of **every** rendered sentence:
```js
return s.charAt(0).toUpperCase() + s.slice(1);
```
That turns the leading preposition "з"/"с" into capital "З"/"С" — grammatically
broken Ukrainian/Russian — with the raw English actor noun phrase glued on after.

### Why `a6a6b2c` does NOT fix it
That commit falls back to the English template **only when `missingTokens` is
set** (i.e., action translation partially failed). In the reproduced case the
translation **fully succeeds** — `isLocalized: true`, `missingTokens: null` — so
the guard never triggers and the corrupted string ships. The real bug is
`finalize()` colliding with two lowercase-initial templates; it is independent
of whether translation succeeded.

### Detection blind spot — the Russian half is unmeasured
`scoreC6` (`scripts/test-bills.js:72`) checks `text.includes("З")`, catching the
Ukrainian artifact (6 of the current 35 failures: bills 2108, 1063, 1433, 1464,
1675, 1871). But Cyrillic "С" (U+0421) is a **visual homoglyph of Latin "C"**
(U+0043) and has **no check** — the structurally identical Russian corruption
produces **zero reported failures** despite being equally reproducible. The true
rate of this bug class is roughly **double** what the suite reports, with all
Russian instances completely invisible.

### Trigger condition (why it's intermittent)
The frame only fires when `modal === "cannot"` AND the action text matches
`/\b(fee|charge|payment|remuneration|compensation)\b/`. Additionally, it only
surfaces visibly when the **actor stays in English** (untranslated proper-noun
entity) — which is the common case. With a dictionary-matched fee object (e.g.
"impact fee", "recording fee", "discharge fee") the action translates cleanly,
`missingTokens` stays null, and the corruption ships.

---

## Finding 2 — RCW statutory citations lose their subsection number

**Severity: High (legal-citation accuracy). Reproduced live. 6,812 corpus occurrences.**

### Reproduction
```
Input:  "...as provided in RCW 46.20.311(2) unless the department has reinstated the privilege."
Output: "...as provided in RCW 46.20.311 unless the department has reinstated the privilege."
```

### Root cause
The subsection-navigation-marker strip in `runPipeline`
(`pipeline.js`, the `text.replace(/\s*(?:\(\d{1,2}\)|\([a-z]\))+\s*/g, " ")`
step — the same mechanism behind Defect B) does not distinguish a structural
navigation marker like a leading "(2)" from a **subsection reference embedded in
a statutory citation**. So `RCW 46.20.311(2)` becomes `RCW 46.20.311`, silently
re-pointing the citation at a different/broader provision than the source text
references.

### Scale
**6,812** occurrences of the `RCW <citation>(<subsection>)` pattern across the
2,808-bill corpus (e.g. Bill 1000 "RCW 9.94A.585(4)", Bill 1002
"RCW 41.26.030(17)"). This is directly relevant to the tool's SHB 2475
compliance mission of accurately conveying legal information to LEP communities —
a wrong citation is a correctness failure, not a cosmetic one. Closely related to
Defect B but distinct in impact: B drops cross-references; this corrupts
citations.

---

## Finding 3 — Pervasive stray `)` extraction artifact (~5,854+ occurrences)

**Severity: Medium-High (visible garbage in output). Highest-volume structural issue.**

Traced into Bill 1092's actual rendered output:
```
"...to take a child into custody if: ) A petition is filed with the juvenile court..."
```
Confirmed the stray `)` originates in the **raw corpus text itself**
(`"...into custody if: )(i) A petition is filed... )(ii) an affida..."`), i.e.
at the **first** pipeline stage — the `(( ))` strip + HTML cleanup shared by
`wa-bill-text.js` and `pipeline.js`. It then trickles through sentence-splitting,
actor/action extraction, and into final user-facing text as a visible stray `)`.

**Statistical evidence:** ~5,854 occurrences of the pattern
`\n\)(\([a-z0-9ivxlcdm]{1,5}\))` alone (a stray `)` immediately before a
subsection/list-item marker at the start of a line); preceding-character analysis
shows it overwhelmingly follows sentence-ending punctuation (period 4,126×,
semicolon 946×, colon 150×) + newline. Likely many more with other marker
formats.

**Mechanism (hypothesis, not fully confirmed):** WA bill markup appears to wrap
renumbered subsections with struck-through old numbers nested in new parenthetical
wrappers (e.g. raw `(((13)))(14)`). The non-greedy `(( ))` strip
(`/\(\([\s\S]*?\)\)/g`) matches `(((13))` — consuming one paren too many from the
leading triple-open — and leaves `)(14)` behind. **Caveat:** there are 0 literal
`(((digit` or `))(\d` triple-paren residues left in the corpus, so the exact
mechanism isn't 100% pinned down without access to the original HTML (both
`wslwebservices.leg.wa.gov` and `app.leg.wa.gov` return 403 from this
environment). The empirical pattern is conclusive regardless of the precise cause.
**Distinct from Defect B**, which is about the *later* marker-stripping step
removing legitimate cross-references.

---

## Finding 4 — Hardcoded English-only "no content" fallback in the frontend

**Severity: Medium (localization gap; defeats the tool's core purpose for affected bills).**

When `fetchPlainMeaning` returns no extractable content (e.g. Bill 9117, a
single-section gubernatorial-appointment digest with zero signal language),
`loadBillPlainSummary` displays a **hardcoded English string** at
`legislation.html:1231`:
```
"No actionable provisions were identified in this bill text."
```
instead of the already-existing, already-localized `TRANSLATIONS.no_obligation[lang]`
templates used elsewhere (inside `renderISC`). Worse, `showSummaryControls` is
**never called in this branch**, so the language selector dropdown stays hidden —
an LEP user viewing such a bill cannot even attempt to switch languages, and sees
English regardless of preference.

The test harness's "C1 output is empty" failures for Bill 9117 (all 7 languages)
are a **related but separate** measurement artifact: `scripts/test-bills.js:145`
(`if (!sec.units.length) continue`) skips zero-unit sections when building the
combined translated string, yielding an empty string and a C1 failure that a real
user wouldn't literally see as blank.

---

## Minor / noteworthy items

- **`legislation.html:862`** injects the literal string
  `"[!] Some action phrases remain in English. Dictionary entries are being added."`
  into the displayed summary when `isLocalized` is false. This is exactly the
  `[!]` bracket pattern `scoreC1` fails on. Harmless today because the test
  harness hits `/api/translate-selection` directly and bypasses this frontend
  wrapper — but it would self-sabotage any future test exercising the real
  user-facing path.

- **`scripts/test-bills.js:136`** — `enCombined` is computed but never read. Dead
  code.

- **`pipeline.js` `PERMISSION_RE`** — the negative-lookbehind clause
  `(?<!\bmay not\b.{0,20})` is dead code. `detectSignal`'s priority order means
  "may not" always matches `PROHIBITION_RE` first and short-circuits before
  `PERMISSION_RE` is evaluated.

- **`detectSectionType` priority chain (RULED OUT)** — checked whether
  amendment-classified sections that also carry a delayed effective date lose the
  "Effective [date] —" prefix. Found 30 corpus sections matching both patterns,
  but all are large omnibus appropriation provisos where "effective [date]" is
  incidental historical color (e.g. "...by 56 cents per hour effective July 1,
  2023. (8) $425,000 of the general fund..."), not a genuine delayed-effect
  declaration. Current ordering is correct here; reclassifying would be worse.

---

## Doc/code mismatches noticed during the audit (not bugs, but worth flagging)

- **`CLAUDE.md` describes a `getLocalizedFrame` "English sentence + localized
  frame after em dash" model that does not exist in code.** Grep finds 0 matches
  for `getLocalizedFrame` outside `CLAUDE.md`. The actual render path is
  `renderLocalizedSentence` producing **fully-localized**
  `TRANSLATIONS[lens][subKey][lang]` templates (no em-dash frame-append). Anyone
  reasoning from the doc will mis-model the localization behavior — directly
  relevant to Findings 1 and 4.
- **`api/translate-selection.js` is not in `CLAUDE.md`'s Files map** despite being
  actively used by both the frontend and the test harness.

---

## Suggested triage order (for the fix thread)

1. **Finding 1 (`З`/`С`)** — clearest "ship now" case: live-reproduced, the
   recent fix misses it, and half the surface is unmeasured. A fix likely lives
   in `finalize()` (skip upper-casing when the template is one of the two
   lowercase-initial Cyrillic frames, or build correct capitalization into those
   templates) **plus** adding a `С` (U+0421) homoglyph check to `scoreC6`.
2. **Finding 2 (RCW citations)** — high legal-accuracy impact, 6,812 instances;
   needs the marker-strip to exempt `RCW <cite>(...)` (and pairs with Defect B,
   so fix together).
3. **Finding 3 (stray `)`)** — highest volume; fix at the extraction stage. Pin
   down the raw-markup mechanism first (needs HTML access from a network-permitted
   environment).
4. **Finding 4 (frontend fallback)** — localize the empty-content message and
   reveal the language selector.
5. Minor items as cleanup.
