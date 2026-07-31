#!/usr/bin/env node
// Regression suite for the fronted-conditional-clause boundary fix —
// confirms a sentence-initial subordinate clause ("If X finds that Y, the
// board may Z") no longer swallows the main clause's own modal into the
// relative clause's span, which was defaulting a permission to a stated
// obligation. Calls the exported runPipeline through the public interface
// and asserts on the rendered plainMeaning, mirroring
// scripts/test-modal-classifier.js's real-code-path philosophy but checking
// final rendered text rather than the internal signal fields, since that is
// what a reader actually sees.
// Usage: node scripts/test-fronted-conditional-boundary.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";
import { renderISC } from "../lib/plain-meaning/renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/fronted-conditional-boundary-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { plainMeaning } = renderISC(runPipeline(c.sentence));
  const lower = plainMeaning.toLowerCase();
  const failures = [];

  if (c.mustEqual !== undefined) {
    if (plainMeaning !== c.mustEqual) {
      failures.push(`expected exact match:\n    ${JSON.stringify(c.mustEqual)}\n  got:\n    ${JSON.stringify(plainMeaning)}`);
    }
  }

  for (const phrase of c.mustContain || []) {
    if (!lower.includes(phrase.toLowerCase())) {
      failures.push(`missing required phrase: "${phrase}"`);
    }
  }

  for (const phrase of c.mustNotContain || []) {
    if (lower.includes(phrase.toLowerCase())) {
      failures.push(`forbidden phrase present: "${phrase}"`);
    }
  }

  if (failures.length === 0) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    failures.forEach((f) => console.log(`  ${f}`));
    console.log(`  rendered: ${JSON.stringify(plainMeaning)}`);
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
process.exit(failCount > 0 ? 1 : 0);
