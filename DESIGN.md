# WA Civic Dashboard — Design

This describes how `lib/plain-meaning/pipeline.js` and
`lib/plain-meaning/renderer.js` work right now. It's a description of the
current mechanism, not a history of how it got here.

The system turns one section of bill text into plain-English sentences with
no AI involved. Every output sentence is traceable back to an exact span of
the original input text. Two stages do this:

1. **The pipeline** (`pipeline.js`, `runPipeline`) — takes raw section text,
   splits it into sentences, finds which sentences contain a rule (an
   obligation, permission, or prohibition), and pulls structured fields
   (who, what, when, how) out of each one. Output: a list of "ISC units,"
   one per rule-bearing sentence, plus a lineage record of every transform
   that touched the text along the way.
2. **The renderer** (`renderer.js`, `renderISC`) — takes that list of ISC
   units and turns each one into a plain-English sentence using a template
   keyed to a "scope lens."

---

## The pipeline, in actual execution order

The file's layer numbering (L1–L10) is the conceptual model, not the run
order. L1 (5WIH) and L10 (ISC) are both assembly steps — they run last,
combining what every other layer produced. Here's what `runPipeline`
actually does, in order, for one section of text:

1. **Wrap the text in a tracked string.** (See "The Meaning Lineage Schema"
   below.)
2. **Strip `(( ... ))` markup** — WA's struck/substituted-text notation.
   Deleted outright, not rendered.
3. **Collapse whitespace and trim.**
4. **Detect section type** (`detectSectionType`) — run here, before the
   amendment-header strip, because the header text it looks for ("is
   amended to read as follows") is still present at this point.
5. **Strip the amendment header**, if present (`AMENDMENT_HEADER_RE`).
6. **Strip the new-section header**, if present (`NEW_SECTION_HEADER_RE`).
7. **Strip subsection navigation markers** — `(1)`, `(2)(a)`, `(b)`, etc.
   This is four sub-steps, each producing its own lineage record: markers
   after a semicolon/colon are deliberately left alone (recorded, not
   silently skipped — they sit mid-sentence in a colon/semicolon-joined
   list, not at a real sentence boundary); markers after a sentence-ending
   period are replaced with a single internal break character; a marker at
   the very start of the text is stripped outright; then whitespace is
   collapsed again.
8. **L2 SSE — split into sentences and detect a signal.** `splitSentences`
   breaks the cleaned text into candidate sentences. Each candidate is
   checked against three regexes, in this order: `PROHIBITION_RE`,
   `OBLIGATION_RE`, `PERMISSION_RE` — first match wins, so a sentence
   containing both an obligation phrase and "may" is tagged `obligation`,
   not `permission`. Sentences with no match are recorded in the lineage
   (so "checked, found nothing" is explicit) and dropped — they never
   become a unit.
9. **For each signal-bearing sentence, build one ISC unit** (`buildUnit`).
   Inside this step, the remaining layers run against that single sentence:
   - **L3 CFS** — constraint filter. If the sentence matches an
     intent/narrative pattern (`intends to`, `seeks to`, `aims to`,
     `designed to`, `purpose is to`), the sentence is dropped here and
     produces no unit. A lineage record is made either way.
   - **L4 LNS** — normalize: strip a leading `Sec. N.` / `Section N` header
     and collapse whitespace.
   - **L5 AAC** — actor/action/condition parsing
     (`parseActorActionCondition`): find the modal verb via `MODAL_RE`,
     split the sentence into the text before it (the actor) and after it
     (the action), and pull out condition clauses (`if`, `when`, `unless`,
     `except`, `provided that`, `subject to`, `upon`, `only if`).
   - **L6 TPS** — temporal parsing: pull deadlines (`within N days`, `no
     later than ...`), triggers (`upon`, `after`, `following`, `once`), and
     sequence phrases (`before`, `after`, `then`, `prior to`, `subsequent
     to`).
   - **L7 SJM** — jurisdiction mapping: tag Washington State vs. federal,
     and pull a controlling entity ("the department of ...") if present.
   - **L8 MPS** — mechanism parsing: pull a "by/through/via/using/pursuant
     to" mechanism phrase and an enforcement phrase (`penalty`, `fine`,
     `violation`, `failure to comply`, `subject to a fine/penalty`, or the
     literal word `enforcement`).
   - **L9 RDS** — risk decomposition: pull likelihood phrases (`may`,
     `might`, `could`, `likely`, `possible`, `probable`) and consequence
     phrases (`resulting in`, `subject to`, `leading to`, `cause(s/d)`, or
     the literal word `consequence`).
   - **L1 5WIH** — assemble all of the above into the `what` / `who` /
     `where` / `when` / `why` / `how` fields.
   - **L10 ISC** — assemble the final unit object (shape below).
10. Return `{ inputLength, sentenceCount, unitCount, units, lineage }` for
    the whole section.

### Section types

`detectSectionType` tags every section with exactly one of six types,
checked in this order — first match wins:

| Type | Trigger |
|---|---|
| `addition` | Contains `NEW SECTION` |
| `amendment` | Contains "is amended to read as follows" |
| `repeal` | Contains "is repealed" / "are each repealed" |
| `delayed` | Contains "effective" / "takes effect" followed by a calendar date — captures the date string as `effectiveDate` (truncated to 40 characters if the matched text runs longer) |
| `appropriation` | Contains "is appropriated" / "sum of $..." |
| `standard` | None of the above |

Every unit built from a section carries that section's type on
`unit.sectionType`.

---

## The Meaning Lineage Schema

The pipeline's core guarantee: every piece of output text can point back to
the exact `[start, end]` character span of the original section text it
came from, even after multiple destructive edits (stripping markup,
collapsing whitespace, removing headers).

### Tracked strings

A "tracked" value is `{ text, offsets }` — `offsets[i]` is the index that
`text[i]` occupied in the original section text. Every transform function
(`stripGlobal`, `stripPrefix`, `collapseRunsAndTrim`,
`stripMidSubsectionMarkers`) takes a tracked string and returns a new one,
carrying surviving characters' original offsets forward and dropping the
offsets of anything removed.

### The chain

One chain per section: `{ records: [], nextNodeId: 0 }`. Every step in the
pipeline that touches the section's text appends one record to
`chain.records` and gets the next id from the shared counter. There's only
one kind of record — there's no separate node/edge structure, because every
snapshot of text already *is* the result of the step that produced it.

A record looks like:

```
{
  id:           number,         // sequential, unique within one section's chain
  parentNodeId: number | null,  // null only for the section's root record
  text:         string,         // the text snapshot after this step
  producedBy:   string,         // which step produced this record
  position:     [number, number] | null,  // absolute span into the original section text
  rule:         string | null,  // which specific pattern/rule this step applied
  matched:      boolean | null, // whether the rule actually changed/flagged anything
  locateFailed?: true,          // present (true) only when position couldn't be verified by direct slicing; omitted otherwise
}
```

The very first record (`section_split`) has `parentNodeId: null`. Its
`text` is the untouched input — the only record where that's true. Every
later record's `parentNodeId` points at the record for the step
immediately before it, so walking `parentNodeId` backward from any record
always retraces the section's real processing order, regardless of where
the record sits in the `records` array.

**Two record lists come back from `runPipeline`:**
- `lineage.section.records` — the section-level preamble chain (one
  straight line: root → markup strip → whitespace collapse → header strips
  → marker strips), plus every L3 CFS record.
- `lineage.sentences` — one record per candidate sentence found by L2 SSE,
  each parented to the same record: the final preamble record.

Each ISC unit also carries its own single sentence record directly, at
`unit.lineage.sentence`, plus a copy of the full section record list at
`unit.lineage.section.records`.

### The branch point

The preamble steps (strikeout strip, whitespace normalize, header strips,
subsection-marker strips) form one straight chain. After the last of them,
the section is split into candidate sentences. Every candidate — including
ones with no obligation/permission/prohibition signal, which get dropped
and never become a unit — gets its own `sentence_split` record. All of
them share the same `parentNodeId`: the id of that final preamble record.
This is the one deliberate branch point in the chain. Sentences are
siblings of each other, not a continuing sequence, and that relationship
is explicit in the data rather than something a reader has to infer from
array order.

For a sentence that survives to become a unit, `buildUnit`'s constraint
filter (L3 CFS) adds one more record, parented to that sentence's own
`sentence_split` record — a **child**, not an ancestor. So the full path
for one unit isn't a straight line from root to leaf; it's the preamble
chain, then a sibling fan-out to the unit's own sentence record, then one
more record hanging off that.

### What `position` and `locateFailed` actually mean

`position` is always `[start, end]` in the original, untouched section
text — not in whatever intermediate text that step was working on.
`locateFailed` answers one narrow question: does slicing the *original*
section text at this exact `position` reproduce this record's `text`,
character for character? It is not a general "something went wrong" flag.

It can be `false` even after real deletions (removing a whole header or
subsection marker tracks cleanly), and it can be `true` even when the
position looks reasonable — the clearest case is whitespace collapse. If a
single `"\n"` between two subsections gets collapsed to a single `" "`,
the character offsets on either side of it stay contiguous, but slicing
the original text at that span still contains the original `"\n"`, not
the rewritten `" "`. That one substituted character is enough to flag the
whole record. This is intentional: an honest "couldn't verify this span"
beats a silent false "verified," which is what the position-tracking fix
earlier in this project's history was specifically about.

A sentence record can also carry `position: null` — this happens only when
`splitSentences`' candidate sentence text can't be re-located inside the
tracked text it was split from. That case is forced to `locateFailed: true`
rather than defaulting to `[0, 0]`, which would otherwise look like a
verified match at the very start of the section.

`locateFailed` is only attached to a record when it's `true` — every other
record keeps the plain shape above.

---

## The ISC unit

The object `buildUnit` returns for each signal-bearing, non-filtered
sentence:

```
{
  sectionType: { type: "addition"|"amendment"|"repeal"|"delayed"|"appropriation"|"standard", effectiveDate?: string },
  tetherAnchor: {
    type: "text_span",
    sourceSystem: "plain_meaning_pipeline",
    sourceLocation: string,       // "sentence_N"
    anchorText: string,           // the original sentence text
    sourceDerivedText: string,    // the L4-normalized text
    matchedSignals: ["obligation"|"permission"|"prohibition"],
    traceReason: string,
  },
  parse: {
    what: { claim: string, action: string|null, conditions: string[] },
    who:  { responsibleParty: string|null, modal: string|null },
    where: { jurisdiction: string|null, system: string|null, controllingEntity: string|null },
    when: { deadlines: string[], triggers: string[], sequence: string[] },
    why:  { statedReason: null },   // never populated — no layer extracts a stated reason
    how:  { mechanism: string|null, enforcement: string|null },
  },
  risk: { likelihood: string[], consequences: string[] },
  missingSignals: string[],   // "missing_actor" and/or "missing_enforcement"
  controlFlags: [],           // always empty — reserved field, no layer populates it yet
  driftDetected: false,       // always false — reserved field, no layer sets it yet
  status: "ok" | "incomplete",  // "incomplete" whenever missingSignals is non-empty
  lineage: { section: { records: [...] }, sentence: {...} },
}
```

`missingSignals` gets `"missing_actor"` when an action was extracted but
no actor was, and `"missing_enforcement"` when the sentence is an
obligation with no enforcement mechanism found.

This shape is specific to what `pipeline.js` produces. `POST
/api/plain-meaning` also accepts a `units` array supplied directly by an
external TCS Python pipeline, bypassing `runPipeline` entirely — those
units are not held to this shape (see "Where it's wired in" below).

---

## The renderer

`renderUnit` turns one ISC unit into one plain-English sentence. `renderISC`
runs that over every unit in a section's output and joins the results.

**Two render paths bypass templates entirely**, driven directly by
`sectionType`:
- `repeal` → `"<actor> is/are no longer in effect."`
- `appropriation` → pulls a dollar amount, a recipient ("to the department
  of ..."), and a purpose ("for the purposes of ...") straight out of the
  raw anchor text with dedicated regexes, not through the lens system.

**Everything else goes through `classifyLens`.** It tests the sentence
text plus its conditions against five patterns, in this fixed order —
first match wins, default is `modality_shift`:

1. `obligation_removal` — "no longer required", "not required", "no
   obligation", a requirement/obligation/restriction/prohibition/fee
   being "removed/waived/exempted/eliminated", or "no longer X".
2. `threshold_shift` — a number + unit (percent, days, months, years,
   hours, weeks), "no less/more/fewer than", "at least/most", "minimum",
   "maximum", "no later than", "threshold", "standard", or
   rounding/adjustment language.
3. `actor_power_shift` — "responsible for", "authority", "authorized to",
   "delegate(d/ion)", "approved by", "reports to" (verb form), "in
   consultation with", "under the direction of".
4. `action_domain_shift` — inspection/audit/review/assessment/
   monitoring/certification/submission/conduct/performance/training/
   documentation/implementation/maintenance language.
5. `scope_change` — "throughout", "across all", "all covered", "applies
   to", "regardless of". (Deliberately narrow — generic words like
   "all/each/any" were excluded because they false-matched almost every
   section.)

**Compound actions are split before rendering.** If the extracted action
string contains `and must`/`and shall`/`and may`/`and cannot` (etc.),
`splitCompoundAction` divides it into two clauses, each rendered separately
with its own modal, and joined with a blank line. Clause 2 reuses the
original sentence's actor if its own render attempt comes up empty.

**Each lens has a template function** that takes the unit's extracted
fields (`actor`, `modal`, `action`, `conditions`, `deadlines`,
`enforcement`) and returns a sentence string, or `null` if it can't
produce something sound:
- `modality_shift` — `"<actor> <modal> <action>"`, or `"This section
  <requires/allows/prohibits>: <action>"` with no actor.
- `actor_power_shift` — `"<actor> is responsible for <action>"`. Returns
  `null` if there's no actor, no action, or the action is still a bare
  passive infinitive ("be construed", "be designated") after
  prefix-stripping — that phrasing doesn't grammatically pair with "is
  responsible for".
- `scope_change` — `"<actor> <modal> <action>"`, or `"<actor> applies to
  everyone involved"` with no action.
- `threshold_shift` — a special cash-rounding phrasing when the action
  contains both rounding language and a cent amount; otherwise `"<actor>
  <modal> <action>, <threshold>"`.
- `action_domain_shift` — `"<actor> <modal> <action>"`, with
  conditions/deadlines appended.
- `obligation_removal` — `"<actor> is/are no longer required to
  <action>"` (the is/are choice follows the sentence's original modal
  text, not the actor string), with any co-present threshold or condition
  appended (a conditional removal isn't rendered as a blanket one).

**If a template returns `null`, `renderUnit` falls back to
`plainify(unit.tetherAnchor.anchorText)`** — a generic legalese-to-plain-
English rewriter. It substitutes a fixed list of legal phrases (`shall
not` → `may not`, `pursuant to` → `under`, etc.), then tries to
reconstruct a `<subject> <modal> <action>` sentence around the first `may
not|cannot|must|may` match. If that reconstruction doesn't produce
something sane (subject too long, action too short), it returns `null`
too, and the unit drops out of the output entirely.

**`renderISC`** maps every unit through `renderUnit`, drops units with no
sentence, de-duplicates identical sentences, and joins what's left with
blank lines between them. It also computes one section-type prefix for the
whole output (`"New law — "`, `"Amends existing law — "`, `"Funding — "`,
`"Effective <date> — "` for delayed sections, nothing for
`standard`/`repeal`) applied once, not per sentence. If no units survive,
the output is a fixed message: `"This section is repealed and no longer
in effect."` for repeals, `"No obligation or change detected in this
section."` otherwise.

---

## `traceRenderUnit` — connecting a rendered sentence back to the chain

`lib/plain-meaning/renderer.js` exports `traceRenderUnit(unit)`. It takes
one ISC unit (the kind `runPipeline` produces, or — in principle — any
unit with the same `lineage` shape) and returns either `null` or:

```
{
  sourceSpan: {
    position: [start, end],   // in the original section text
    text: "...",              // root.text.slice(start, end)
    locateFailed: false,
  },
  steps: [
    { producedBy: "section_split", rule: null, matched: null, text: "..." , position: [...] },
    { producedBy: "strikeout_strip", rule: "(( )) markup", matched: false, text: "...", position: [...] },
    ... // every preamble step, in order
    { producedBy: "sentence_split", rule: "OBLIGATION_RE", matched: true, text: "...", position: [...] },
    { producedBy: "L3 CFS", rule: null, matched: false, text: "...", position: [...] },
  ],
}
```

How it builds that:

1. Start at `unit.lineage.sentence` — the unit's own `sentence_split`
   record — and `unit.lineage.section.records` — the section's full
   record list. If either is missing, return `null` immediately.
2. Walk `parentNodeId` from that record back to the root (`parentNodeId:
   null`), collecting every record visited, then reverse the list so it
   reads in the order the pipeline actually ran.
3. Find the unit's own `L3 CFS` record — the one whose `parentNodeId`
   equals the sentence record's id — and append it after the walked
   chain, since it's a child step, not an ancestor.
4. Build `sourceSpan` by slicing the *root* record's `text` (the section's
   original, untouched input) at the sentence record's own `position`.
   That slice is the literal span of source text this sentence came from.

Returning `null` for missing or malformed lineage matters at one real
boundary: `POST /api/plain-meaning` also accepts a `units` array supplied
directly by the TCS Python pipeline (see `api/plain-meaning.js`). Those
units skip `runPipeline` entirely and may carry no `lineage` field at all.
`traceRenderUnit` treats that as a normal, expected case — not an error —
and the caller gets `trace: null` rather than a thrown exception.

---

## Where it's wired in

`renderUnit(unit, { debug })` calls `traceRenderUnit(unit)` and attaches
the result as `trace`, as a sibling of the existing `debug` field, only
inside the same `debug`-gated branch that already exists. When `debug` is
not passed (or is `false`), neither `debug` nor `trace` appears on a
sentence at all — the default per-sentence shape is exactly what it was
before this existed. When `debug: true` is passed, each sentence in the
response carries both its existing debug field breakdown and this trace.

This per-sentence gating is separate from the API's top-level `lineage`
field: `api/plain-meaning.js` always returns `lineage:
iscOutput.lineage?.section ?? null` regardless of `debug` — present
whenever the request went through the raw-`text` path (`runPipeline`
builds a chain either way), `null` for the `units`-input path (which
never builds one). That top-level field predates `traceRenderUnit` and
isn't part of its debug gate; only the per-sentence `debug`/`trace` pair
is conditional on the `debug` flag.
