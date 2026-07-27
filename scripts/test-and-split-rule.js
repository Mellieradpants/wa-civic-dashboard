#!/usr/bin/env node
// Regression suite for the "and"-split rule -- duties joined by "and" where
// the second duty does not repeat its actor. A fixed set of real,
// bill-derived sentences with confirmed-correct answers, validated over
// four rounds against a 212-bill sample. Mirrors
// scripts/test-split-instructions.js's approach, but asserts on the
// rendered plain-meaning text, since this rule splits at render time
// (unitCount stays the same -- see the "baseline-same-actor-zero-gap-compound"
// case in data/wa/split-instruction-test-cases.json).
// Usage: node scripts/test-and-split-rule.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";
import { renderUnit } from "../lib/plain-meaning/renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/and-split-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence, { billId: "and-split-test" });
  const rendered = units.map((u) => renderUnit(u).sentence).filter(Boolean).join("\n\n");
  const paragraphs = rendered.split("\n\n");

  const countOk = paragraphs.length === c.expectedParagraphCount;
  const containsOk = !c.paragraphContains || c.paragraphContains.every(
    (substr, i) => paragraphs[i] && paragraphs[i].toLowerCase().includes(substr.toLowerCase())
  );
  const startsOk = !c.mustStartWith || (paragraphs[0] || "").startsWith(c.mustStartWith);
  const notContainsOk = !c.mustNotContain || c.mustNotContain.every(
    (substr) => !rendered.toLowerCase().includes(substr.toLowerCase())
  );

  if (countOk && containsOk && startsOk && notContainsOk) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    if (!countOk) {
      console.log(`  expected ${c.expectedParagraphCount} paragraph(s), got ${paragraphs.length}`);
    }
    if (!containsOk) {
      console.log(`  expected paragraphContains not satisfied. Got:`);
      paragraphs.forEach((p, i) => console.log(`    [${i}] ${p}`));
    }
    if (!startsOk) {
      console.log(`  expected first paragraph to start with "${c.mustStartWith}", got: ${paragraphs[0]}`);
    }
    if (!notContainsOk) {
      console.log(`  rendered text contained a forbidden substring: ${rendered}`);
    }
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
if (failCount > 0) process.exit(1);
