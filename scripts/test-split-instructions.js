#!/usr/bin/env node
// Regression suite for the "and"-joined two-instruction split (L5 AAC) — a
// fixed set of real, bill-derived sentences with confirmed-correct answers,
// independent of the bill-sampling harness (scripts/test-bills.js). Mirrors
// scripts/test-modal-classifier.js's approach: runs the real, exported
// runPipeline() rather than calling internal pipeline.js functions directly.
// Usage: node scripts/test-split-instructions.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/split-instruction-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence, { billId: "split-instruction-test" });
  const countOk = units.length === c.expectedUnitCount;
  const actors = units.map((u) => u.parse.who.responsibleParty);
  const actorsOk = !c.expectedActors || JSON.stringify(actors) === JSON.stringify(c.expectedActors);

  if (countOk && actorsOk) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    if (!countOk) {
      console.log(`  expected ${c.expectedUnitCount} unit(s), got ${units.length}`);
    }
    if (!actorsOk) {
      console.log(`  expected actors: ${JSON.stringify(c.expectedActors)}`);
      console.log(`  got actors:      ${JSON.stringify(actors)}`);
    }
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
if (failCount > 0) process.exit(1);
