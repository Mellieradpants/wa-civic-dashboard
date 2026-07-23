#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Discovery sweep only: catalogs how real bill sentences separate multiple
// duties (two or more force-words: shall/must/may/will), grouped by which of
// a set of candidate separator families appears. Raw output only — no
// design, no fixes, no pipeline changes. Also runs each kept sentence
// through the real, exported runPipeline() to record how many duties the
// current pipeline actually produces, so the gap is visible in the record.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
// Same pool construction as every prior discovery sweep: sentinels + confirmed
// no-document SGA bills excluded, plus the whole 4000-4999 and 8000-8999
// ranges (memorials/resolutions — declaratory text, not obligation text).
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

function splitSentences(text) {
  return text
    .split(/(?<=[.!?;])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// ─── Force-word counting ────────────────────────────────────────────────────

const FORCE_WORD_RE = /\b(shall|must|may|will)\b/gi;
function countForceWords(sentence) {
  const matches = sentence.match(FORCE_WORD_RE);
  return matches ? matches.length : 0;
}

// ─── Candidate separator families — matched for grouping/reporting only ───────

const SEPARATOR_FAMILIES = [
  {
    name: "PROVIDED_THAT",
    re: /\bPROVIDED,?\s+That\b|\bPROVIDED\s+FURTHER,?\s+That\b|\bAND\s+PROVIDED\s+FURTHER,?\s+That\b/i,
  },
  {
    name: "COMMA_OR_AND_NEW_ACTOR_FORCE_WORD",
    // e.g. "the speaker shall, or any member may, call the member to order"
    re: /,\s*(?:or|and)\s+(?:[A-Za-z][a-zA-Z'\-]*\s+){1,8}?(?:shall|must|may|will)\b/i,
  },
  {
    name: "IF_UNLESS_OWN_FORCE_WORD",
    re: /\b(?:if|unless)\b[^.;:]{0,200}?\b(?:shall|must|may|will)\b/i,
  },
  {
    name: "EXCEPT_THAT",
    re: /\bexcept that\b/i,
  },
  {
    name: "HOWEVER",
    re: /\bhowever\b/i,
  },
  {
    name: "IN_WHICH_CASE",
    re: /\bin which case\b/i,
  },
  {
    name: "SEMICOLON_NEW_ACTOR",
    re: /;\s*(?:the|a|an|any|each|every|no|such)\s+(?:[A-Za-z][a-zA-Z'\-]*\s+){0,4}?(?:shall|must|may|will)\b/i,
  },
];

function matchedFamilies(sentence) {
  const matched = [];
  for (const { name, re } of SEPARATOR_FAMILIES) {
    if (re.test(sentence)) matched.push(name);
  }
  return matched;
}

// ─── Duties produced by the current pipeline ───────────────────────────────

function countPipelineDuties(sentence, billId) {
  try {
    const { unitCount } = runPipeline(sentence, { billId });
    return unitCount;
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log(`Pool size (excluding sentinels, no-document bills, and 4000-4999/8000-8999 ranges): ${pool.length}`);
console.log(`Sampling every ${step} bills, ${batch.length} bills total: ${batch.join(", ")}\n`);

const seen = new Map(); // sentence text -> { billNumber, sectionId, families, duties, forceWordCount, occurrences: [{bill, section}] }
let candidateCount = 0;
let billsFetchedOk = 0;

for (const billNumber of batch) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), BIENNIUM);
  } catch (err) {
    console.log(`Bill ${billNumber}: SKIP — ${err.message}`);
    continue;
  }
  billsFetchedOk++;
  for (const section of data.sections || []) {
    if (!section.text?.trim()) continue;
    for (const sentence of splitSentences(section.text)) {
      if (sentence.length < 60) continue;
      const forceWordCount = countForceWords(sentence);
      if (forceWordCount < 2) continue;
      candidateCount++;
      if (seen.has(sentence)) {
        seen.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        continue;
      }
      const families = matchedFamilies(sentence);
      const duties = countPipelineDuties(sentence, String(billNumber));
      seen.set(sentence, {
        forceWordCount,
        families,
        duties,
        occurrences: [{ bill: billNumber, section: section.id }],
      });
    }
  }
}

console.log(`Total candidate sentences (with duplicates): ${candidateCount}`);
console.log(`Distinct sentences after dedup: ${seen.size}\n`);

const familyCounts = {};
const noFamilySentences = [];
let printedIdx = 0;

for (const [sentence, { forceWordCount, families, duties, occurrences }] of seen.entries()) {
  const familyLabel = families.length ? families.join(",") : "none";
  for (const f of families.length ? families : ["none"]) {
    familyCounts[f] = (familyCounts[f] || 0) + 1;
  }
  if (families.length === 0) noFamilySentences.push({ sentence, duties, forceWordCount, occurrences });

  printedIdx++;
  const firstOcc = occurrences[0];
  const dupNote = occurrences.length > 1
    ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  console.log(`--- RESULT ${printedIdx} — bill ${firstOcc.bill}, section ${firstOcc.section}, families=${familyLabel}, duties=${duties}, forceWords=${forceWordCount}${dupNote} ---`);
  console.log(`sentence: ${sentence}`);
  console.log();
}

console.log("\nSummary counts per separator family (a sentence may match more than one, or none):");
for (const [family, count] of Object.entries(familyCounts)) {
  console.log(`  ${family}: ${count}`);
}

console.log(`\n\n=== Sentences matching NO known family (${noFamilySentences.length}) — candidates for additional families ===\n`);
noFamilySentences.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  const dupNote = entry.occurrences.length > 1
    ? ` [appeared in ${entry.occurrences.length} places: ${entry.occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  console.log(`--- NO-FAMILY ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}, duties=${entry.duties}, forceWords=${entry.forceWordCount}${dupNote} ---`);
  console.log(`sentence: ${entry.sentence}`);
  console.log();
});

console.log(`\nDone. ${batch.length} bills sampled, ${billsFetchedOk} bills fetched successfully, ${candidateCount} candidate sentences found (with duplicates), ${seen.size} distinct sentences classified, ${noFamilySentences.length} matched no known family.`);
