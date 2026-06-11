# Seven-Language Translation Audit — June 11, 2026

Manual dining-room audit: HB 2366 (school board compensation) rendered in all 7 target languages via the live app, compared line-by-line against the English pivot. Conducted by Mellie (decision-maker, visual/pattern review) with outside-analyst classification. This document is the evidence base for the next fix phase; commits should reference its finding numbers.

## Governing principles (binding on all fixes)
1. STRUCTURAL FIXES ONLY. Root cause or nothing. No output-side patches, no band-aids, no detect-and-scrub of broken renderings.
2. NO HOLLOW ABSTRACTIONS. Every function, field, or wrapper must demonstrably do work — provable caller, provable effect. Scaffolding without a consumer ships only as visible TODO debt, never as disguised completeness.
3. PER-LANGUAGE MACHINERY IS LEGITIMATE. Each language's grammar is a root cause, not an edge case. Languages share the English pivot and the ledger; they never share each other's grammar. We are solving 7 languages over a controlled English (5 fields, 4 modals, bounded shapes) — finite grammar work per language.
4. EXISTING SANITIZERS (Somali, Korean) ARE ON NOTICE under principle 1: any sanitizer logic that masks a template defect gets replaced by the template fix and deleted. Diagnosis of what they actually do precedes any Tier 3 work on those languages.

## TIER 1 — Pivot defects (broken identically in all 7; fix at extraction, heal everywhere)
- T1.1 HEADLESS SENTENCES [MEANING-CRITICAL]: "This section requires: be compensated" / "This section allows: only be collected..." — actor lost at extraction; headless fallback template fires in every language. Reader cannot tell who the law applies to.
- T1.2 VANISHING CONDITIONS [MEANING-CRITICAL]: "must be authorized" renders without "by the board of directors at a regularly scheduled meeting" in all 7. Trailing conditions/details dropped at extraction when dictionary covers the verb. Incomplete obligations shipped as complete.
- T1.3 STRAY SPACE: "expenses , including" — pre-comma space artifact, all languages (Finding 3 family).
- T1.4 PARSE-SHAPE MISS: "The office of financial management must at intervals not to exceed five years, review and adjust..." — adverbial between modal and verb defeats extraction; whole sentence falls back to English in all 7. Honest failure (correct English shown), lower priority.

## TIER 2 — Family defects (ru/uk shared machinery)
- T2.1 FEE-TEMPLATE CORRUPTION [MEANING-CRITICAL]: ru "С School directors не взимается быть начислен." / uk "З School directors не справляється бути стягнений." — Finding 1 captured live, both variants (С and З), Cyrillic preposition glued to English actor plus word-salad verb chain. Redesigned harness C6 check (Cyrillic + Latin) covers both.
- T2.2 AGREEMENT SYSTEM GAP: invariant masculine-singular обязан/зобов'язаний bolted onto all subjects; case errors (вся/любая → всю/любую; компенсація → компенсацію). Inflected languages cannot be served by invariant templates — needs agreement-aware machinery or case-neutral phrasings. Wrong but decipherable; Tier 3 scheduling.

## TIER 3 — Single-language structural defects
- T3.1 KOREAN MODAL STACKING [MEANING-CRITICAL]: dictionary verb form + modal concatenated, not conjugated — "받다 할 수 있다", "개발하다 하여야 한다" throughout. Plus INTRA-SENTENCE DUPLICATION: complete correct rendering followed by broken fragment of the same unit ("...포기할 수 있습니다. 포기하다 할 수 있다."). Possible sanitizer interaction — diagnose sanitizer first per principle 4.
- T3.2 TAGALOG RENDER-LEVEL TRUNCATION [MEANING-CRITICAL]: line 1 rendered as "maaaring tumanggap ng kompensasyon." — $100/day, purpose, and $13,750 cap all dropped. Other 6 languages kept the details, so the unit carried them: loss is in the Tagalog render path, distinct from T1.2's extraction-level loss.
- T3.3 SOMALI VERB DISPLACEMENT: action verb stranded sentence-final, separated from "waa in" by the full object clause ("waa in ... milicsado", "... horumar", "... kor u qaad"); reader must reassemble the obligation. Also dropped sentence-final periods on two lines (suspect sanitizer). Diagnose sanitizer first per principle 4.
- T3.4 SPANISH: fee line broken ("no se podrá ser cobrado"); plural agreement misses ("los gastos ... deberá ser pagado" → deberán ser pagados).

## TIER 4 — Coverage (dictionary phase)
- T4.1 ENGLISH ACTORS EVERYWHERE: actors are raw extracted bill text, never dictionary keys — every sentence stays half-English at any dictionary coverage. Needs actor-phrase dictionary + assembly design. Single biggest "less English" lever.
- T4.2 The 1,383-entry manifest (post-sequencing-fix, phantoms removed) = itemized dictionary debt.
- T4.3 Disclaimer alignment: page promises 338-bill/95%/±5% validation; ~45 distinct bills tested to date. Six 50-bill runs closes the gap and makes the claim true.

## Language health ranking (structural)
Vietnamese > Tagalog > Somali > Spanish > Ukrainian ≈ Russian > Korean

## Agreed fix order
1. This document committed (anchor)
2. T1.1 + T1.2 as one extraction diagnosis→fix cycle (seven-language payoff)
3. T3.2 Tagalog truncation
4. T3.1 Korean (sanitizer diagnosis first)
5. T2.1 ru/uk fee corruption
6. Remaining tiers, evidence-ordered; T4 dictionary phase per provenance model (official / consensus-draft / single-draft)
