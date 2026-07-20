#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Wider data-collection sweep: samples ~200 bills spread evenly across the
// whole pool (not one contiguous window) and prints every real sentence
// containing "including"/"excluding", verbatim. Raw output only — no
// categorization, no boundary logic, no interpretation.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
// Excludes sentinels + the 5 confirmed no-document SGA bills (9241-9245),
// plus the whole 4000-4999 range here specifically — House Joint
// Memorials/Resolutions/Concurrent Resolutions, which are "WHEREAS...; and"
// declaratory preambles, not substantive obligation text (confirmed by an
// earlier scan that landed there).
const excludedNumbers = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);

const pool = [...new Set(
  BILL_INDEX.map(b => Number(b.bill_number))
    .filter(n => !excludedNumbers.has(n))
    .filter(n => !(n >= 4000 && n <= 4999))
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

console.log(`Pool size (excluding sentinels, no-document bills, and 4000-4999 memorials/resolutions): ${pool.length}`);
console.log(`Sampling every ${step} bills, ${batch.length} bills total: ${batch.join(", ")}\n`);

let candidateCount = 0;
let continuesAfterListCount = 0;
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
      const m = /\b(including|excluding)\b/i.exec(sentence);
      if (!m) continue;
      candidateCount++;

      const remainingLength = sentence.length - (m.index + m[0].length);
      if (remainingLength > 60) continuesAfterListCount++;

      console.log(`--- CANDIDATE ${candidateCount} — bill ${billNumber}, section ${section.id}, marker="${m[0]}", ${sentence.length} chars, ${remainingLength} chars after marker ---`);
      console.log(sentence);
      console.log();
    }
  }
}

console.log(`\nDone. ${batch.length} bills sampled, ${billsFetchedOk} bills fetched successfully, ${candidateCount} candidate sentences found, ${continuesAfterListCount} with more than 60 characters remaining after the "including"/"excluding" marker.`);
