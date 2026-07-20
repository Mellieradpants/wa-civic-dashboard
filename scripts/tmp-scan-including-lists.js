#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Real-data discovery only: finds real bill sentences containing "including"
// or "excluding" and prints them in full, verbatim. No list-boundary logic
// here at all — the whole point is to look at real examples before
// designing anything, since a previous attempt at this failed by swallowing
// everything from "including" to the end of the sentence, destroying the
// sentence's real main instruction whenever it continued after the list.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 40;

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const excluded = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);

const pool = [...new Set(BILL_INDEX.map(b => Number(b.bill_number)).filter(n => !excluded.has(n)))].sort((a, b) => a - b);

const cursorStart = Number(process.env.SCAN_CURSOR_START || 1200) % pool.length;
const batch = [];
for (let i = 0; i < SAMPLE_SIZE; i++) batch.push(pool[(cursorStart + i) % pool.length]);

function splitSentences(text) {
  return text
    .split(/(?<=[.!?;])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

console.log(`Scanning ${batch.length} bills for sentences containing "including" or "excluding": ${batch.join(", ")}\n`);

let candidateCount = 0;
let continuesAfterListCount = 0;

for (const billNumber of batch) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), BIENNIUM);
  } catch (err) {
    console.log(`Bill ${billNumber}: SKIP — ${err.message}`);
    continue;
  }
  for (const section of data.sections || []) {
    if (!section.text?.trim()) continue;
    for (const sentence of splitSentences(section.text)) {
      const m = /\b(including|excluding)\b/i.exec(sentence);
      if (!m) continue;
      candidateCount++;

      // Purely descriptive, not a boundary algorithm: does the sentence keep
      // going for a while after the "including"/"excluding" word, measured
      // in raw remaining character count? This just flags candidates worth
      // a closer look, it does not attempt to find the real list end.
      const remainingLength = sentence.length - (m.index + m[0].length);
      const looksLikeItContinues = remainingLength > 60;
      if (looksLikeItContinues) continuesAfterListCount++;

      console.log(`--- CANDIDATE ${candidateCount} — bill ${billNumber}, section ${section.id}, marker="${m[0]}", ${sentence.length} chars, ${remainingLength} chars after marker ---`);
      console.log(sentence);
      console.log();
    }
  }
}

console.log(`\nDone. ${batch.length} bills scanned, ${candidateCount} candidate sentences found, ${continuesAfterListCount} with more than 60 characters remaining after the "including"/"excluding" marker.`);
