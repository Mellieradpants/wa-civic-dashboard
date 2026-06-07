# Sentence-Level Dedup — Insertion Plan (read-only analysis, no edits made yet)

## Where the bill-level assembly lives

There are two "combine sections into one bill output" points in production
code, both in `legislation.html`, and both already do a coarser form of
dedup that the C6 test failures slip past.

### fetchPlainMeaning (legislation.html:743-772)
Assembles the English bill summary:

```js
const seenMeanings = new Set();
results.forEach((r, i) => {
  ...
  if (seenMeanings.has(plainMeaning)) return;   // dedupes whole-SECTION strings
  seenMeanings.add(plainMeaning);
  meanings.push(plainMeaning);
  ...
});
return { text: meanings.join("\n\n"), ... };
```

### fetchTranslation (legislation.html:778-803)
Same pattern for the localized bill summary:

```js
const seenTr = new Set();
results.forEach(r => {
  ...
  if (seenTr.has(r.value.plainMeaning)) return;  // same: whole-SECTION strings
  seenTr.add(r.value.plainMeaning);
  meanings.push(r.value.plainMeaning);
  ...
});
return { text: meanings.join("\n\n"), isLocalized };
```

## Why these miss the C6 failures

Both Sets key on the ENTIRE per-section plainMeaning string. The C6 "Full
duplication" failures (bills 1092, 1433, 5890, 2398) are sentence/paragraph
level repeats inside the combined bill text — e.g. one section's body
contains a sentence that another section's body also contains, but the two
sections' full plainMeaning strings differ (different prefixes, different
surrounding sentences), so seenMeanings/seenTr never see a match and the
repeat ships through untouched.

renderISC (renderer.js:974-980) DOES dedupe at sentence granularity already:

```js
const seen = new Set();
const rendered = units.map((u) => renderUnit(u, lang)).filter((r) => {
  if (!r.sentence) return false;
  if (seen.has(r.sentence)) return false;
  seen.add(r.sentence);
  return true;
});
```

But its `seen` Set is local to one renderISC call — i.e. one section. It
resets every section, so it can't catch repeats ACROSS sections of the same
bill.

## Where I'd insert the fix

In both fetchPlainMeaning and fetchTranslation, replace the whole-string
seenMeanings/seenTr check with paragraph-level dedup against a SINGLE Set
shared across all sections of the bill:

1. Split each section's plainMeaning on "\n\n" — the same separator
   renderISC uses to join sentences (renderer.js:1007 and :926).
2. For each resulting paragraph, check/add it to one shared `seen` Set
   spanning the whole results.forEach loop (NOT reset per section).
3. Keep only never-seen paragraphs, in order; rejoin the survivors with
   "\n\n"; skip pushing anything if nothing survives.

This is roughly a 5-line change to the two existing loops — no new
functions, reusing the Set-based pattern already in place, just moving the
comparison granularity from "whole section" to "paragraph" and the Set's
scope from per-section-string to per-bill-paragraph.

## One open question before touching anything

Section-type prefixes ("New law — ", "Amends existing law — ") are glued
directly onto the FIRST paragraph of plainMeaning (renderer.js:1013, no
separator). So "New law — X." and "Amends existing law — X." will NOT match
even though the substantive sentence "X." is identical — only byte-identical
paragraphs (prefix included) get suppressed.

That's almost certainly the right call (different classification framing
isn't really "the same sentence twice"), but flagging it so you can confirm
that's the behavior you want rather than stripping prefixes before
comparing.
