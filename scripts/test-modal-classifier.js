#!/usr/bin/env node
// Regression suite for the relative-clause signal classifier — a fixed set of
// known tricky sentences with confirmed-correct answers, independent of the
// bill-sampling harness (scripts/test-bills.js). Runs each sentence through
// the real, exported runPipeline() rather than calling the internal
// detectSignals() directly, since detectSignals is not exported and this
// suite must not modify pipeline.js to reach it — reading the classification
// off the resulting unit's tetherAnchor exercises the same real code path any
// real caller goes through.
// Usage: node scripts/test-modal-classifier.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/modal-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

function classify(sentence) {
  const { units } = runPipeline(sentence, { billId: "modal-test" });
  // A sentence can now produce more than one unit (see pipeline.js's L5 AAC
  // second-instruction detection). None of the fixtures below trigger that
  // yet, so checking only units[0] is still correct for this suite — but a
  // future fixture that does trigger it would need this to check units[1]
  // too, not just silently ignore it.
  const unit = units[0];
  if (!unit) return { primary: null, additional: [] };
  return {
    primary: unit.tetherAnchor.matchedSignals[0] ?? null,
    additional: unit.tetherAnchor.subordinateClauseSignals ?? [],
  };
}

function additionalMatches(actual, expected) {
  if (actual.length !== expected.length) return false;
  return expected.every((exp, i) =>
    actual[i].marker === exp.marker &&
    actual[i].signal === exp.signal &&
    actual[i].clauseText === exp.clauseText
  );
}

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const result = classify(c.sentence);
  const primaryOk = result.primary === c.expectedPrimary;
  const additionalOk = additionalMatches(result.additional, c.expectedAdditional);

  if (primaryOk && additionalOk) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    if (!primaryOk) {
      console.log(`  expected primary: ${JSON.stringify(c.expectedPrimary)}, got: ${JSON.stringify(result.primary)}`);
    }
    if (!additionalOk) {
      console.log(`  expected additional: ${JSON.stringify(c.expectedAdditional)}`);
      console.log(`  got additional:      ${JSON.stringify(result.additional)}`);
    }
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
if (failCount > 0) process.exit(1);
