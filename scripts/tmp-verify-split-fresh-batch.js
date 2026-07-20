#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Runs the REAL, merged runPipeline (the actual shipped code, not a naive
// text scan) against a fresh batch of real bills never touched by any of
// tonight's earlier scans, and reports every section where the pipeline
// produced more units than sentences — i.e. a real split actually fired.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 40;

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const excluded = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);

const pool = [...new Set(BILL_INDEX.map(b => Number(b.bill_number)).filter(n => !excluded.has(n)))].sort((a, b) => a - b);

const cursorStart = Number(process.env.SCAN_CURSOR_START || 600) % pool.length;
const batch = [];
for (let i = 0; i < SAMPLE_SIZE; i++) batch.push(pool[(cursorStart + i) % pool.length]);

console.log(`Fresh batch (cursor ${cursorStart}), never touched by any earlier scan tonight: ${batch.join(", ")}\n`);

let splitCount = 0;
let sectionCount = 0;
let sentenceTotal = 0;
let unitTotal = 0;

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
    sectionCount++;
    const result = runPipeline(section.text, { billId: String(billNumber) });
    sentenceTotal += result.sentenceCount;
    unitTotal += result.unitCount;
    if (result.unitCount > result.sentenceCount) {
      splitCount++;
      console.log(`--- SPLIT FOUND — bill ${billNumber}, section ${section.id} (${result.sentenceCount} sentences → ${result.unitCount} units) ---`);
      for (const unit of result.units) {
        console.log(`  anchorText: ${unit.tetherAnchor.anchorText}`);
        console.log(`  unit: actor=${JSON.stringify(unit.parse.who.responsibleParty)} modal=${JSON.stringify(unit.parse.who.modal)} action=${JSON.stringify(unit.parse.what.action)}`);
      }
      console.log();
    }
  }
}

console.log(`\nDone. ${batch.length} bills scanned, ${sectionCount} non-empty sections, ${sentenceTotal} total sentences, ${unitTotal} total units, ${splitCount} sections with a real split.`);
