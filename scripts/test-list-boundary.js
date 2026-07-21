#!/usr/bin/env node
// Regression suite for the including/excluding list-boundary detector — a
// fixed set of real, bill-derived sentences with confirmed-correct answers,
// independent of the bill-sampling harness (scripts/test-bills.js). Mirrors
// scripts/test-modal-classifier.js's approach: runs the real, exported
// runPipeline() rather than calling internal pipeline.js functions directly.
// Usage: node scripts/test-list-boundary.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/list-boundary-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

function detect(sentence, billId) {
  const { units } = runPipeline(sentence, { billId });
  const unit = units[0];
  if (!unit) return { inclusionLists: [], sourceDerivedText: null };
  return {
    inclusionLists: unit.tetherAnchor.inclusionLists ?? [],
    sourceDerivedText: unit.tetherAnchor.sourceDerivedText ?? null,
  };
}

function listsMatch(actual, expected) {
  if (actual.length !== expected.length) return false;
  return expected.every((exp, i) =>
    actual[i].marker === exp.marker &&
    actual[i].classification === exp.classification &&
    actual[i].listText === exp.listText
  );
}

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const result = detect(c.sentence, c.billId || "list-boundary-test");
  const listsOk = listsMatch(result.inclusionLists, c.expectedInclusionLists);

  // Self-consistency check: every recorded [start, end) span must reproduce
  // its own listText when sliced from the text the detector actually ran
  // against — catches an offset bug even when the text itself matches.
  let spanOk = true;
  for (const entry of result.inclusionLists) {
    if (entry.listText === null) continue;
    if (result.sourceDerivedText?.slice(entry.start, entry.end) !== entry.listText) {
      spanOk = false;
    }
  }

  if (listsOk && spanOk) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    if (!listsOk) {
      console.log(`  expected: ${JSON.stringify(c.expectedInclusionLists)}`);
      console.log(`  got:      ${JSON.stringify(result.inclusionLists)}`);
    }
    if (!spanOk) {
      console.log(`  a recorded [start, end) span did not reproduce its own listText`);
    }
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
if (failCount > 0) process.exit(1);
