#!/usr/bin/env node
// Regression suite for the and-joined relative-pronoun guard in
// detectSecondInstruction -- "and which/that/who/whom/whose <modal> ..." is
// a relative clause continuing the previous noun phrase, not a coordinate
// clause with a new actor, and must not be split off as an orphan sentence
// fragment. Mirrors scripts/test-and-split-rule.js's approach: asserts on
// rendered plain-meaning text (via renderUnit, joined per-unit), since a
// genuine coordinate split happens at the pipeline level (a real second
// unit) while a same-actor split happens separately at render time.
// Usage: node scripts/test-and-relative-pronoun.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";
import { renderUnit } from "../lib/plain-meaning/renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/and-relative-pronoun-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence, { billId: "and-relative-pronoun-test" });
  const rendered = units.map((u) => renderUnit(u).sentence).filter(Boolean).join("\n\n");
  const paragraphs = rendered.split("\n\n");

  const failures = [];

  if (paragraphs.length !== c.expectedParagraphCount) {
    failures.push(`expected ${c.expectedParagraphCount} paragraph(s), got ${paragraphs.length}`);
  }

  // Structural check, always on: no paragraph may begin with an orphaned
  // relative pronoun -- the exact defect shape this suite guards against.
  // A startsWith check on the split paragraphs, not a case-insensitive
  // substring search over the whole rendered text, since the correct fix
  // legitimately keeps the same words ("which", "that", ...) present
  // mid-sentence.
  for (const [i, p] of paragraphs.entries()) {
    if (/^(Which|That|Who|Whom|Whose)\b/.test(p)) {
      failures.push(`paragraph [${i}] is an orphaned relative-pronoun fragment: ${JSON.stringify(p)}`);
    }
  }

  for (const [i, substr] of (c.paragraphContains || []).entries()) {
    if (!paragraphs[i] || !paragraphs[i].toLowerCase().includes(substr.toLowerCase())) {
      failures.push(`paragraph [${i}] expected to contain "${substr}", got: ${JSON.stringify(paragraphs[i])}`);
    }
  }

  for (const substr of c.mustContain || []) {
    if (!rendered.toLowerCase().includes(substr.toLowerCase())) {
      failures.push(`rendered text missing required substring: "${substr}"`);
    }
  }

  for (const substr of c.mustNotContain || []) {
    if (rendered.toLowerCase().includes(substr.toLowerCase())) {
      failures.push(`rendered text contained forbidden substring: "${substr}"`);
    }
  }

  if (failures.length === 0) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    failures.forEach((f) => console.log(`  ${f}`));
    console.log(`  rendered:\n${rendered}`);
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
process.exit(failCount > 0 ? 1 : 0);
