# Chat Notes — Companion to PIPELINE_DEFECT_REPORT.md

This file captures everything said in the working session *outside* the formal
report (`PIPELINE_DEFECT_REPORT.md`): the original investigation write-up as it
was first delivered, the handoff commentary, the read-only/commit reasoning, and
the git branch-conflict flag. Reproduced verbatim so nothing is lost in handoff.

---

## 1. Original investigation write-up (as first delivered in chat)

> Investigation complete. Here's the full report of additional defects found
> beyond A, B, and C — all read-only, no edits made.

### Headline finding: the "З"/"С" stray-Cyrillic defect is still live on `main`'s tip — the recent fix only covers half the cases

I confirmed this **directly against the running server** (current `main`,
including commit `a6a6b2c` "Stop shipping garbled localized sentences when action
translation partially fails"):

```
POST /api/plain-meaning {"text": "The agency cannot impose impact fee."}
→ POST /api/translate-selection {lang: "uk"} → "З The agency не справляється нав'язати плата за вплив."   (isLocalized: true)
→ POST /api/translate-selection {lang: "ru"} → "С The agency не взимается навязывать плата за воздействие." (isLocalized: true)
```

**Root cause:** `renderer.js:753` and `:757` contain the *only two templates in
the entire system* that intentionally start with a lowercase letter — Ukrainian
"з" (U+0437, the preposition "from/with") and Russian "с" (U+0441, "with/from") —
used for the `cannot`+fee frame. `finalize()` (`renderer.js:330-335`)
unconditionally runs `s.charAt(0).toUpperCase()` on every rendered sentence,
corrupting these prepositions into capital "З"/"С" — grammatically broken
Ukrainian/Russian, with a raw English actor noun phrase glued on right after.

**Why `a6a6b2c` didn't fix it:** that commit added a `missingTokens` guard that
falls back to the English template *only when action translation partially
fails*. But in the case I reproduced, translation **fully succeeds**
(`isLocalized: true`, `missingTokens: null`) — so the guard never triggers, and
the capitalization corruption ships anyway. The bug isn't about partial
translation; it's `finalize()` colliding with two specific templates' leading
character.

**Detection blind spot — the Russian half is invisible to the test suite:**
`scoreC6` checks `text.includes("З")`, which catches the Ukrainian artifact (6 of
the current 35 failures). But Cyrillic "С" (U+0421) is a **visual homoglyph of
Latin "C"** (U+0043) — there is no check for it, so the structurally identical
Russian corruption produces **zero** reported failures even though it's equally
garbled and equally reproducible. The true defect rate for this bug class is
roughly double what's reported, with the Russian instances completely unmeasured.

### Second finding: pervasive stray `)` extraction artifact (~5,854+ occurrences corpus-wide)

Traced into Bill 1092's actual rendered output ("...into custody if: ) A petition
is filed..."). Originates at the very first pipeline stage — the `(( ))` strip +
HTML cleanup in `wa-bill-text.js`/`pipeline.js` — and trickles through
sentence-splitting, actor/action extraction, and into final user-facing text as a
visible stray `)`. Distinct from Defect B (which concerns the *later*
subsection-marker-stripping step incorrectly removing legitimate cross-references
like "(b)").

### Third finding: RCW statutory citations lose their subsection number

The **same** subsection-navigation-marker strip behind Defect B
(`text.replace(/\s*(?:\(\d{1,2}\)|\([a-z]\))+\s*/g, " ")`) also corrupts legal
citations. Confirmed live:

```
Input:  "...as provided in RCW 46.20.311(2) unless the department has reinstated the privilege."
Output: "...as provided in RCW 46.20.311 unless the department has reinstated the privilege."
```

The `(2)` is silently dropped, changing the citation to point at a
different/broader statutory provision than the source text actually references. I
found **6,812** occurrences of `RCW <citation>(<subsection>)` patterns across the
corpus — this is a citation-accuracy issue with direct relevance to the tool's
compliance mission (accurately conveying legal information to LEP communities).

### Fourth finding: hardcoded English-only "no content" fallback in `legislation.html`

When `fetchPlainMeaning` returns no extractable content (e.g., Bill 9117),
`loadBillPlainSummary` displays a **hardcoded English string** at
`legislation.html:1231` ("No actionable provisions were identified in this bill
text.") instead of the already-existing, already-localized
`TRANSLATIONS.no_obligation[lang]` templates used elsewhere in `renderISC`.
`showSummaryControls` is never called in this branch either, so the language
selector stays hidden — an LEP user viewing such a bill cannot even attempt to
switch languages. (Note: the test harness's "C1 output is empty" failures for
Bill 9117 are a related but separate measurement artifact — its
`if (!sec.units.length) continue` skips zero-unit sections from the combined
string.)

### Minor / noteworthy items

- **`legislation.html:862`** injects the literal string `"[!] Some action phrases
  remain in English..."` into the displayed summary when `isLocalized` is false.
  This is exactly the bracket-bang pattern `scoreC1` searches for and fails on. It
  currently causes no harm because the test harness calls `/api/translate-selection`
  directly, bypassing this frontend wrapper — but it would self-sabotage any
  future test that exercises the real user-facing path.
- **`enCombined`** (`scripts/test-bills.js:136`) is computed but never read — dead
  code.
- **`PERMISSION_RE`**'s negative-lookbehind clause `(?<!\bmay not\b.{0,20})` is
  dead code — `detectSignal`'s priority order means "may not" always matches
  `PROHIBITION_RE` first and short-circuits before `PERMISSION_RE` is evaluated.
- I checked the `detectSectionType` priority chain (amendment → ... → delayed) for
  compound-classification loss and found 30 corpus sections matching both patterns
  — but all are large omnibus appropriation provisos where "effective [date]" is
  incidental historical color (e.g., "...by 56 cents per hour effective July 1,
  2023. (8) $425,000 of the general fund..."), not a genuine delayed-effect
  declaration for the section itself. **Ruled out** — the current ordering
  produces correct results here; reclassifying these as "delayed" would be worse.

### Summary (as originally delivered)

The two defects with the clearest "ship it now" evidence are the **"З"/"С"
capitalization bug** (live-reproduced, `isLocalized: true`, the recent fix doesn't
cover it, and half the failure surface is invisible to the test suite) and the
**RCW citation subsection-stripping** (6,812 occurrences, directly degrades
legal-citation accuracy). The stray-`)` corpus artifact remains the highest-volume
structural issue (~5,854+ instances) but its precise raw-markup mechanism is still
not 100% pinned down without HTML access.

---

## 2. Handoff commentary (when the report file was delivered)

> Done — `PIPELINE_DEFECT_REPORT.md` is a single self-contained handoff. It's
> written so your work partner needs no prior context: it recaps Defects A/B/C in
> one paragraph, then lays out the four new findings with live reproductions, root
> causes (file:line), scale evidence, and a triage order.
>
> The structure:
>
> 1. **Finding 1 — `З`/`С` Cyrillic corruption** (headline): live-reproduced on
>    current `main`, the `a6a6b2c` fix misses it because translation *succeeds*
>    (`missingTokens: null`), root cause is `finalize()` upper-casing the only two
>    lowercase-initial templates, and the Russian half is invisible to the suite
>    (homoglyph `С`/`C`).
> 2. **Finding 2 — RCW citation subsection stripping**: 6,812 occurrences,
>    legal-accuracy impact, pairs with Defect B.
> 3. **Finding 3 — stray `)` extraction artifact**: ~5,854+ occurrences, traced to
>    the extraction stage, mechanism hypothesis flagged as not-fully-confirmed.
> 4. **Finding 4 — hardcoded English-only frontend fallback** + hidden language
>    selector.
>
> Plus minor items (the `[!]` injection, dead code, dead lookbehind, the ruled-out
> `detectSectionType` case) and two `CLAUDE.md` doc/code mismatches that matter for
> reasoning about Findings 1 and 4.
>
> One note for the handoff: the file lives in the working tree but isn't committed
> — it'll vanish when this container is reclaimed. The copy I sent you is durable,
> but say the word if you also want it committed/pushed to the branch.
>
> I made no code changes, per the read-only constraint.

**File-delivery caption:**

> Self-contained defect report — drop straight into the other thread. Covers all 4
> new findings (headline: the З/С Cyrillic bug still live + half-invisible to
> tests), minor items, doc/code mismatches, and a suggested triage order. Recaps
> Defects A/B/C only for context.

---

## 3. Read-only / commit reasoning (response to the stop-hook git flag)

> The only untracked item is the report I generated — `node_modules` is already
> gitignored, so nothing stray. The report is a deliverable doc, not a code change,
> so committing it wouldn't break the read-only constraint on the pipeline itself.
> But you framed this session as read-only and didn't ask for a commit/push, and
> you already have the durable copy I sent you — so I don't want to push to the
> branch on my own.

**The options presented for handling the untracked file:**

- **Commit + push to branch** — Commit `PIPELINE_DEFECT_REPORT.md` to
  `claude/wa-civic-dashboard-author-email-167LN` and push it. Note: `CLAUDE.md`
  says "always push directly to main", which conflicts with this feature branch —
  flagging that.
- **Commit, don't push** — Commit locally so the hook clears, but leave the remote
  untouched until you decide where it goes.
- **Leave it untracked** — Keep the working tree as-is. You already have the
  durable copy I sent; the file will vanish when the container is reclaimed.

---

## 4. Report-completeness confirmation + git branch-conflict flag

> You're right — the report should stand on its own. I checked: every substantive
> finding I put in chat is already in the report (all four findings with live
> reproductions, the homoglyph detection gap, the minor items, the ruled-out
> `detectSectionType` case, the doc/code mismatches, and the triage order). The
> only things I said in chat that *aren't* in it are session logistics
> (durable-copy status, the git-branch question) — which are noise in a partner
> handoff, so I'll keep those out and stop narrating around the report.
>
> For the untracked file: I'll commit it locally so the deliverable is preserved in
> the repo and the hook clears. I'm not pushing — that's outward-facing and you
> didn't ask for it, and there's a conflict to surface first (below).

After committing (`756e215` on `claude/wa-civic-dashboard-author-email-167LN`,
working tree clean):

> **One conflict to surface before any push:** `CLAUDE.md` says *"Always push
> directly to main. No feature branch by default. If any prior instruction,
> workflow file, or config references a different branch, disregard it and flag
> it."* — but this session's harness assigned me the feature branch
> `claude/wa-civic-dashboard-author-email-167LN`. These two directly contradict
> each other on where pushes should go. Per CLAUDE.md's own instruction I'm
> flagging it rather than silently picking one.
>
> So I've held off pushing entirely. When you want it remote, tell me which target:
>
> - **main** (what CLAUDE.md says), or
> - **the feature branch** (what the session config says).
>
> Either is a one-line follow-up. The durable copy I already sent you is unaffected
> regardless.
