#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Scans a real batch of bills for sentences containing "and" with 2+ modal
// words (must/shall/may/cannot), and prints each full sentence verbatim.
// Original, uncorrected candidate rule only — no actor validation applied.

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

const cursorStart = Number(process.env.SCAN_CURSOR_START || 0) % pool.length;
const batch = [];
for (let i = 0; i < SAMPLE_SIZE; i++) batch.push(pool[(cursorStart + i) % pool.length]);

const MODAL_RE = /\b(must|shall|may|cannot)\b/gi;

// Also breaks on ";" before a lettered/numbered list marker — WA bill text
// has long semicolon-joined statutory lists ("(a) ...; (b) ...; (c) ...")
// with no periods at all, which the period-only version of this splitter
// swallowed as one giant multi-thousand-character fake "sentence" last run.
function splitSentences(text) {
  return text
    .split(/(?<=[.!?;])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

console.log(`Scanning ${batch.length} bills for candidate "and" + 2-modal sentences: ${batch.join(", ")}\n`);

let candidateCount = 0;

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
      if (!/\band\b/i.test(sentence)) continue;
      const modalMatches = sentence.match(MODAL_RE) || [];
      if (modalMatches.length < 2) continue;
      candidateCount++;
      console.log(`--- CANDIDATE ${candidateCount} — bill ${billNumber}, section ${section.id}, modals: ${modalMatches.join(", ")} (${sentence.length} chars) ---`);
      console.log(sentence);
      console.log();
    }
  }
}

console.log(`\nDone. ${batch.length} bills scanned, ${candidateCount} candidate sentences found.`);
