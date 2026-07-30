#!/usr/bin/env node
// Regression suite for the modal-aware actor_power_shift fix — confirms
// permission ("may") is rendered plainly instead of inverted into an
// obligation ("is responsible for"), confirms the obligation branch's
// grammar fix (a gerund, not a bare verb stem), confirms prohibition never
// becomes a stated duty, and confirms existing obligation rendering
// elsewhere is not over-corrected into permission.
// Usage: node scripts/test-modal-aware-templates.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";
import { renderISC } from "../lib/plain-meaning/renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/modal-aware-template-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { plainMeaning } = renderISC(runPipeline(c.sentence));
  const lower = plainMeaning.toLowerCase();

  const failures = [];

  for (const phrase of c.mustContain || []) {
    if (!lower.includes(phrase.toLowerCase())) {
      failures.push(`missing required phrase: "${phrase}"`);
    }
  }

  if (c.mustContainAny) {
    const found = c.mustContainAny.some((phrase) => lower.includes(phrase.toLowerCase()));
    if (!found) {
      failures.push(`expected one of ${JSON.stringify(c.mustContainAny)}, found none`);
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
