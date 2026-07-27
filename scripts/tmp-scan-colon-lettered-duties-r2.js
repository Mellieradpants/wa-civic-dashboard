#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Validation run #2: replaces round 1's boundary logic (an arbitrary
// character/gap window that merged separate lists together -- Defect 1)
// with rules grounded in standard English grammar:
//
//   1. A colon introduces a list.
//   2. A comma or semicolon alone never ends a list -- semicolons replace
//      commas between items that are long or contain their own commas.
//   3. A period ends a sentence. Wherever a period appears in place of a
//      semicolon between what looked like list items, the item before it
//      was a complete, independent sentence of its own (subject and finite
//      verb, not dependent on the lead-in) -- the "list" was never really
//      one instruction. If this happens at the very first item, the whole
//      construction is NOT-A-LIST (Defect 2: ordinary statutory subsection
//      numbering, not a real list).
//   4. A semicolon has two uses: LIST-CONTINUING (joins a fragment that
//      depends on the lead-in for its subject/verb) and SENTENCE-JOINING
//      (joins two independent clauses). Test: can the text after the
//      semicolon stand alone as a complete sentence (its own subject and
//      finite verb) if the semicolon were a period? If yes, the list ends
//      there (SENTENCE-JOINING-SEMICOLON).
//
// isIndependentClause() is a necessarily approximate proxy for "has its own
// subject and finite verb": it requires the item to open with a
// subject-like word (a determiner, pronoun, or "Both/Neither/Either/All")
// AND to contain, anywhere in its text, one of a fixed set of modal,
// auxiliary, or copula words (shall/must/may/will/can/could/would/should/
// is/are/was/were/has/have/had). This is a real, disclosed limitation, not
// a full parse: a modal/auxiliary embedded in a RELATIVE CLAUSE ("... in
// which controlled substances were sold ...") is indistinguishable, by this
// heuristic, from the item's own main verb -- so an item that is genuinely
// a dependent fragment, but happens to contain a "which/who/that ... was/
// were/is/are/has/have" relative clause, will be misread as independent.
// Every record produced by this misreading is flagged
// possibleEmbeddedClauseFalsePositive so it can be reviewed separately
// rather than silently trusted. Same 212-bill sample as round 1, same
// sampling code (verbatim from scripts/tmp-scan-nonduty-categories.js via
// git history).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(__dirname, "../tmp-scan-colon-lettered-duties-r2-results.txt");

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const excludedNumbers = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);
const pool = [...new Set(
  BILL_INDEX.map(b => Number(b.bill_number))
    .filter(n => !excludedNumbers.has(n))
    .filter(n => !(n >= 4000 && n <= 4999))
    .filter(n => !(n >= 8000 && n <= 8999))
)].sort((a, b) => a - b);

const step = Math.max(1, Math.floor(pool.length / SAMPLE_SIZE));
const batch = [];
for (let i = 0; i < pool.length; i += step) batch.push(pool[i]);

const out = [];
const log = (line = "") => out.push(line);

log(`Bill count in this run's sample: ${batch.length} (expected 212)`);
if (batch.length !== 212) {
  log(`STOP: sample count is ${batch.length}, not 212. Not proceeding with the scan.`);
  writeFileSync(OUTPUT_FILE, out.join("\n"));
  console.log(out.join("\n"));
  process.exit(0);
}
log(`Pool size (excluding sentinels, no-document bills, and 4000-4999/8000-8999 ranges): ${pool.length}`);
log(`Sampling every ${step} bills: ${batch.join(", ")}\n`);

function singleLine(s) {
  return s.replace(/\s+/g, " ").trim();
}

// ─── Grammar-grounded boundary detection ────────────────────────────────────

const FORCE_RE = /\b(shall|must|may|will)\b/i;
const DEFINITION_LEADIN_RE = /\bmeans?\s*(the\s+following)?$/i;
const FACTOR_KEYWORDS_RE = /\b(consider(ing)?|factors?|criteria|weigh(ing)?|in\s+determining)\b/i;

const SUBJECT_RE = /^(The|A|An|This|That|These|Those|Any|Each|Every|No|Such|Both|Neither|Either|All|Some|Many|Most|He|She|It|They|We|You|I)\b/;
const FINITE_AUX_RE = /\b(shall|must|may|will|can|could|would|should|is|are|was|were|has|have|had)\b/;
const RELATIVE_PRONOUN_RE = /\b(which|who|whom|that)\b/i;

function isIndependentClause(text) {
  const t = (text || "").trim();
  if (!SUBJECT_RE.test(t)) return false;
  return FINITE_AUX_RE.test(t);
}

function possibleEmbeddedClauseFalsePositive(text) {
  const t = (text || "").trim();
  const auxMatch = t.match(FINITE_AUX_RE);
  if (!auxMatch) return false;
  return RELATIVE_PRONOUN_RE.test(t.slice(0, auxMatch.index));
}

function tightMarkerAt(text, idx) {
  const window = text.slice(idx, idx + 24);
  const m = window.match(/^(\s*(?:and\s+|or\s+)?)\(([a-z]{1,3}|[ivxlcdm]{1,5}|\d{1,3})\)/i);
  if (!m) return null;
  return { prefix: m[1], marker: m[2] };
}

function nextTerminator(text, fromIdx) {
  const semi = text.indexOf(";", fromIdx);
  const per = text.indexOf(".", fromIdx);
  if (semi === -1 && per === -1) return null;
  if (semi === -1) return { idx: per, char: "." };
  if (per === -1) return { idx: semi, char: ";" };
  return semi < per ? { idx: semi, char: ";" } : { idx: per, char: "." };
}

function scanItemAt(text, markerGlobalIdx, marker) {
  const markerEnd = markerGlobalIdx + marker.prefix.length + `(${marker.marker})`.length;
  const term = nextTerminator(text, markerEnd);
  if (!term) return null;
  return { text: text.slice(markerEnd, term.idx).trim(), term };
}

function hasNestedList(itemText) {
  const colonIdx = itemText.indexOf(":");
  if (colonIdx === -1) return false;
  return Boolean(tightMarkerAt(itemText, colonIdx + 1));
}

function findCandidateLists(text) {
  const results = [];
  const colonPositions = [...text.matchAll(/:/g)].map((m) => m.index);

  for (const colonIdx of colonPositions) {
    const first = tightMarkerAt(text, colonIdx + 1);
    if (!first) continue;
    const scan1 = scanItemAt(text, colonIdx + 1, first);
    if (!scan1) continue;

    const before = text.slice(0, colonIdx);
    const leadStartMatches = [...before.matchAll(/[.!?]\s+(?=[A-Z"(])/g)];
    const leadStartMatch = leadStartMatches[leadStartMatches.length - 1];
    const leadStart = leadStartMatch ? leadStartMatch.index + leadStartMatch[0].length : 0;
    const leadIn = text.slice(leadStart, colonIdx).trim();
    const leadInPlusFirstIsOneSentence = !isIndependentClause(scan1.text);

    if (!leadInPlusFirstIsOneSentence) {
      results.push({
        leadIn, isNotAList: true,
        boundaryReason: scan1.term.char === "." ? "COMPLETE-SENTENCE-PERIOD" : "SENTENCE-JOINING-SEMICOLON",
        leadInPlusFirstIsOneSentence,
        embeddedClauseFlag: possibleEmbeddedClauseFalsePositive(scan1.text),
        items: [{ marker: first.marker, text: scan1.text, hasOwnForce: FORCE_RE.test(scan1.text), nested: hasNestedList(scan1.text) }],
        fullText: `${leadIn}: (${first.marker}) ${scan1.text}${scan1.term.char}`,
      });
      continue;
    }

    const items = [{ marker: first.marker, text: scan1.text, hasOwnForce: FORCE_RE.test(scan1.text), nested: hasNestedList(scan1.text) }];
    let cursor = scan1.term.idx + 1;
    let boundaryReason = "END-OF-LIST-PUNCTUATION";
    let embeddedClauseFlag = false;

    if (scan1.term.char === ";") {
      while (true) {
        const next = tightMarkerAt(text, cursor);
        if (!next) { boundaryReason = "END-OF-LIST-PUNCTUATION"; break; }
        const scanN = scanItemAt(text, cursor, next);
        if (!scanN) { boundaryReason = "END-OF-LIST-PUNCTUATION"; break; }

        if (isIndependentClause(scanN.text)) {
          boundaryReason = scanN.term.char === ";" ? "SENTENCE-JOINING-SEMICOLON" : "NEW-LEAD-IN";
          if (possibleEmbeddedClauseFalsePositive(scanN.text)) embeddedClauseFlag = true;
          break;
        }
        items.push({ marker: next.marker, text: scanN.text, hasOwnForce: FORCE_RE.test(scanN.text), nested: hasNestedList(scanN.text) });
        if (scanN.term.char === ".") { boundaryReason = "END-OF-LIST-PUNCTUATION"; break; }
        cursor = scanN.term.idx + 1;
      }
    }

    if (items.length < 2) continue;
    results.push({
      leadIn, isNotAList: false, boundaryReason, leadInPlusFirstIsOneSentence, embeddedClauseFlag,
      fullText: `${leadIn}: ${items.map((it) => `(${it.marker}) ${it.text}`).join("; ")}.`,
      items,
    });
  }
  return results;
}

function classify(record) {
  if (record.isNotAList) return "NOT-A-LIST";
  const { leadIn, items } = record;
  if (DEFINITION_LEADIN_RE.test(leadIn)) return "DEFINITION-LIST";
  const withForce = items.filter((it) => it.hasOwnForce);
  if (withForce.length === 0) {
    if (FACTOR_KEYWORDS_RE.test(leadIn)) return "FACTOR-LIST";
    return FORCE_RE.test(leadIn) ? "SHARED-DUTY" : "OTHER";
  }
  if (withForce.length === items.length && items.length >= 2) return "EACH-ITEM-OWN-FORCE";
  return "MIXED";
}

// ─── Main scan ──────────────────────────────────────────────────────────────

const seen = new Map();
let billsFetchedOk = 0;
let totalRawMatches = 0;

const VERIFY_TARGETS = [
  { bill: 1044, marker: "county treasurer shall deposit" },
  { bill: 1089, marker: "superior court of the county" },
  { bill: 1000, marker: "under the following circumstances" },
];
const verifyHits = [];

for (const billNumber of batch) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), BIENNIUM);
  } catch (err) {
    log(`Bill ${billNumber}: SKIP — ${err.message}`);
    continue;
  }
  billsFetchedOk++;
  for (const section of data.sections || []) {
    if (!section.text?.trim()) continue;
    const text = singleLine(section.text);
    const matches = findCandidateLists(text);
    for (const m of matches) {
      totalRawMatches++;
      const cls = classify(m);
      const key = m.fullText;
      if (seen.has(key)) {
        seen.get(key).occurrences.push({ bill: billNumber, section: section.id });
      } else {
        seen.set(key, { ...m, classification: cls, occurrences: [{ bill: billNumber, section: section.id }] });
      }
      for (const target of VERIFY_TARGETS) {
        if (billNumber === target.bill && m.leadIn.toLowerCase().includes(target.marker)) {
          verifyHits.push({ bill: billNumber, section: section.id, record: seen.get(key) });
        }
      }
    }
  }
}

log(`Bills fetched OK: ${billsFetchedOk} / ${batch.length}`);
log(`Total raw candidate-list matches (with duplicates across bills): ${totalRawMatches}`);
const all = [...seen.values()];
log(`Distinct candidate lists after dedup: ${all.length}\n`);

const byClass = {};
for (const r of all) byClass[r.classification] = (byClass[r.classification] || 0) + 1;
log(`─── Breakdown by classification ───`);
log(`NOT-A-LIST (round 1 incorrectly counted these as lists): ${byClass["NOT-A-LIST"] || 0}`);
for (const [label, count] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
  if (label === "NOT-A-LIST") continue;
  log(`${label}: ${count}`);
}
log("");

// ─── Match-length distribution, compared to round 1 ────────────────────────
const lens = all.map((r) => r.fullText.length).sort((a, b) => a - b);
const pct = (p) => lens[Math.floor(lens.length * p)] ?? lens[lens.length - 1];
const over1500 = lens.filter((n) => n > 1500).length;
log(`─── Match-length distribution (this run) ───`);
log(`n=${lens.length} min=${lens[0]} p25=${pct(0.25)} median=${pct(0.5)} p75=${pct(0.75)} p90=${pct(0.9)} max=${lens[lens.length - 1]}`);
log(`Over 1500 characters: ${over1500} (${((over1500 / lens.length) * 100).toFixed(1)}%)`);
log(`Round 1 comparison: n=2595 (matches, not distinct), median=2052, 65% over 1500 chars, max=11877.`);
log(`(Round 1 counted matches per occurrence, not distinct; this run's n above is distinct candidate lists. See raw file for a like-for-like recount if needed.)\n`);

// ─── Embedded-clause false-positive flag count ─────────────────────────────
const embeddedFlagged = all.filter((r) => r.embeddedClauseFlag);
log(`Records where independence was detected via an auxiliary verb embedded in a relative clause (which/who/that ... was/were/is/are/has/have) -- possible false positive, flagged for review: ${embeddedFlagged.length}\n`);

function printRecord(r, i) {
  log(`[${i}] Occurrences: ${r.occurrences.map((o) => `bill ${o.bill}/${o.section}`).join("; ")}`);
  log(`  FULL TEXT: ${r.fullText}`);
  log(`  LEAD-IN: ${r.leadIn}`);
  log(`  LEAD-IN + FIRST ITEM IS ONE CONTINUOUS SENTENCE: ${r.leadInPlusFirstIsOneSentence}`);
  log(`  BOUNDARY REASON: ${r.boundaryReason}`);
  log(`  EMBEDDED-CLAUSE FLAG: ${r.embeddedClauseFlag}`);
  r.items.forEach((it) => {
    log(`    ITEM ${it.marker}: hasOwnForce=${it.hasOwnForce} nested=${it.nested} -- ${it.text}`);
  });
  log(`  CLASSIFICATION: ${r.classification}`);
  log("");
}

log(`─── EACH-ITEM-OWN-FORCE and MIXED, in full ───\n`);
const priority = all.filter((r) => r.classification === "EACH-ITEM-OWN-FORCE" || r.classification === "MIXED");
priority.forEach((r, i) => printRecord(r, i + 1));
if (!priority.length) log("(none found)\n");

for (const label of ["SHARED-DUTY", "DEFINITION-LIST", "NOT-A-LIST", "FACTOR-LIST"]) {
  log(`─── Representative sample of ${label} (up to 15) ───\n`);
  const sample = all.filter((r) => r.classification === label).slice(0, 15);
  sample.forEach((r, i) => printRecord(r, i + 1));
  if (!sample.length) log("(none found)\n");
}

log(`─── OTHER, in full ───\n`);
const others = all.filter((r) => r.classification === "OTHER");
others.forEach((r, i) => printRecord(r, i + 1));
if (!others.length) log("(none found)\n");

log(`─── Every case where SENTENCE-JOINING-SEMICOLON closed a list early ───\n`);
const sjs = all.filter((r) => r.boundaryReason === "SENTENCE-JOINING-SEMICOLON" && !r.isNotAList);
sjs.forEach((r, i) => printRecord(r, i + 1));
if (!sjs.length) log("(none found)\n");

log(`─── Nested colon-lists (an item's own text contains another colon+marker sequence) ───\n`);
const withNesting = all.filter((r) => r.items.some((it) => it.nested));
withNesting.forEach((r, i) => printRecord(r, i + 1));
if (!withNesting.length) log("(none found)\n");

log(`─── Verification cases ───\n`);
log(`Target 1 -- bill 1044 county treasurer deposit (expect: single, correctly bounded SHARED-DUTY, 2 items):`);
const v1 = verifyHits.filter((v) => v.bill === 1044);
if (v1.length) v1.forEach((v) => printRecord(v.record, 1)); else log("NOT FOUND in this run's sample.\n");

log(`Target 2 -- bill 1089 superior court (expect: NOT-A-LIST, not EACH-ITEM-OWN-FORCE):`);
const v2 = verifyHits.filter((v) => v.bill === 1089);
if (v2.length) v2.forEach((v) => printRecord(v.record, 1)); else log("NOT FOUND in this run's sample.\n");

log(`Target 3 -- bill 1000 aggravating circumstances (expect: subsection 2's list and subsection 3's nested sub-lists as SEPARATE records, not merged):`);
const v3 = verifyHits.filter((v) => v.bill === 1000);
if (v3.length) v3.forEach((v, i) => printRecord(v.record, i + 1)); else log("NOT FOUND in this run's sample.\n");

writeFileSync(OUTPUT_FILE, out.join("\n"));
console.log(out.join("\n"));
