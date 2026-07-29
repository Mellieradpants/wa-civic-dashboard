# Value-term layer — deferred cases (on the radar, not built)

Deferred cases are parked with evidence, not rejected. Each gets built when a real
bill anchor shows up. This file records why each is empty so the finding doesn't get
re-derived.

## Case 2 — value term resolved by external reference

Status: DEFERRED — no real anchor found.

Finding (397-bill sample, ~14% of the 2025-26 corpus): zero bills resolve a *bare*
value term (e.g. "fairness", "good faith", a bare "equity") by pointing to an
external citation ("as defined in RCW / chapter / U.S.C. / CFR").

Every "value word + as defined in <citation>" hit was a compound defined term — a
program name or role title that merely contains a value word — not a value being
operationalized:
  - "social equity goals as defined in RCW 69.50.335"   (defined program term; cannabis licensing boilerplate, recurs across HB 1433 / SSB 5112 / SB 5921)
  - "health equity zones as defined in RCW 43.70.595"    (defined program term)
  - "child welfare worker as defined in RCW 74.14B.005"  (role title)

Scoping note: the general phenomenon "any term whose meaning is pushed to an external
citation" IS real and common (nearly every bill cross-references "as defined in RCW"),
but that is the separate RCW-citation-awareness idea — a general cross-reference
resolver, not a value-term node. It is not this case.

Build trigger: a real bill where a bare evaluative term (not a compound program name)
is resolved by an external citation. If/when found, Case 2 becomes:
  resolutionState "external", resolutionHolder = the citation (e.g. "RCW 69.50.335"),
  emitted into the existing valueResolution field, reusing EXTERNAL_REFERENCE_RE
  (already present in pipeline.js, currently used as Case 3's guard).

## Delegation cues deferred from Case 3 (already logged in that PR)

- "as defined by rules of <authority>" — real anchor HB 1433 ("...where a conflict of
  interest is presented, as defined by rules of the disciplining authority..."); its
  real source is a non-modal enumerated item with the value term detached from the
  cue, which the current detector does not handle. Needs its own pass.
- "in the (sole) discretion of <authority>" — no real WA anchor found yet.
