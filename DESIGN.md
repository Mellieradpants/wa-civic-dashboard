# WA Civic Dashboard — Design

## Meaning Lineage Schema

Every time `runPipeline` (in `lib/plain-meaning/pipeline.js`) turns a section
of bill text into plain-meaning units, it also builds a record of exactly
what happened to the text along the way. This is the lineage chain. It
exists so any sentence in the final output can be traced back to the literal
span of source text it came from, and to every step that text passed through
to get there.

### The chain

One chain per section: `{ records: [], nextNodeId: 0 }`. Every step in the
pipeline that touches the section's text appends one record to
`chain.records` and gets the next id from the shared counter. There's only
one kind of record — there's no separate node/edge structure, because every
snapshot of text already *is* the result of the step that produced it.

A record looks like:

```
{
  id: 7,
  parentNodeId: 6,
  text: "...",            // the text after this step ran
  producedBy: "whitespace_normalize",
  position: [120, 340],   // [start, end] in the ORIGINAL section text
  rule: "collapse + trim",
  matched: true,          // did this step actually change anything?
  locateFailed: true,     // present only when true — see below
}
```

The very first record (`section_split`) has `parentNodeId: null`. Its `text`
is the untouched input — the only record where that's true. Every later
record's `parentNodeId` points at the record for the step immediately before
it, so walking `parentNodeId` backward from any record always retraces the
section's real processing order, regardless of where the record sits in the
`records` array.

### The branch point

The preamble steps (strikeout strip, whitespace normalize, header strips,
subsection-marker strips) form one straight chain. After the last of them,
the section is split into candidate sentences. Every candidate — including
ones with no obligation/permission/prohibition signal, which get dropped and
never become a unit — gets its own `sentence_split` record. All of them
share the same `parentNodeId`: the id of that final preamble record. This is
the one deliberate branch point in the chain. Sentences are siblings of each
other, not a continuing sequence, and that relationship is explicit in the
data rather than something a reader has to infer from array order.

For a sentence that survives to become a unit, `buildUnit`'s constraint
filter (L3 CFS) adds one more record, parented to that sentence's own
`sentence_split` record — a **child**, not an ancestor. So the full path for
one unit isn't a straight line from root to leaf; it's the preamble chain,
then a sibling fan-out to the unit's own sentence record, then one more
record hanging off that.

### What `position` and `locateFailed` actually mean

`position` is always `[start, end]` in the original, untouched section text
— not in whatever intermediate text that step was working on. `locateFailed`
answers one narrow question: does slicing the *original* section text at
this exact `position` reproduce this record's `text`, character for
character? It is not a general "something went wrong" flag.

It can be `false` even after real deletions (removing a whole header or
subsection marker tracks cleanly), and it can be `true` even when the
position looks reasonable — the clearest case is whitespace collapse. If a
single `"\n"` between two subsections gets collapsed to a single `" "`, the
character offsets on either side of it stay contiguous, but slicing the
original text at that span still contains the original `"\n"`, not the
rewritten `" "`. That one substituted character is enough to flag the whole
record. This is intentional: an honest "couldn't verify this span" beats a
silent false "verified," which is what the position-tracking fix earlier in
this project's history was specifically about.

`locateFailed` is only attached to a record when it's `true` — every other
record keeps the plain shape above.

### `traceRenderUnit` — connecting a rendered sentence back to the chain

`lib/plain-meaning/renderer.js` exports `traceRenderUnit(unit)`. It takes one
ISC unit (the kind `runPipeline` produces, or — in principle — any unit with
the same `lineage` shape) and returns either `null` or:

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

1. Start at `unit.lineage.sentence` — the unit's own `sentence_split` record
   — and `unit.lineage.section.records` — the section's full record list.
   If either is missing, return `null` immediately.
2. Walk `parentNodeId` from that record back to the root (`parentNodeId:
   null`), collecting every record visited, then reverse the list so it
   reads in the order the pipeline actually ran.
3. Find the unit's own `L3 CFS` record — the one whose `parentNodeId`
   equals the sentence record's id — and append it after the walked chain,
   since it's a child step, not an ancestor.
4. Build `sourceSpan` by slicing the *root* record's `text` (the section's
   original, untouched input) at the sentence record's own `position`. That
   slice is the literal span of source text this sentence came from.

Returning `null` for missing or malformed lineage matters at one real
boundary: `POST /api/plain-meaning` also accepts a `units` array supplied
directly by the TCS Python pipeline (see `api/plain-meaning.js`). Those
units skip `runPipeline` entirely and may carry no `lineage` field at all.
`traceRenderUnit` treats that as a normal, expected case — not an error —
and the caller gets `trace: null` rather than a thrown exception.

### Where it's wired in

`renderUnit(unit, { debug })` calls `traceRenderUnit(unit)` and attaches the
result as `trace`, as a sibling of the existing `debug` field, only inside
the same `debug`-gated branch that already exists. When `debug` is not
passed (or is `false`), neither `debug` nor `trace` appears in the response
at all — the default API shape is exactly what it was before this existed.
When `debug: true` is passed, each sentence in the response carries both its
existing debug field breakdown and this trace.
