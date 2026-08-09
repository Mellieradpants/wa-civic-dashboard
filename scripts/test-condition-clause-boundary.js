#!/usr/bin/env node
// Regression suite for the condition-clause comma boundary in
// parseActorActionCondition (extractConditions/findConditionEnd,
// pipeline.js) — confirms a comma only ends an extracted condition when a
// genuine independent clause or coordinate duty begins right after it, and
// otherwise keeps scanning so a list continuation, a participial phrase, a
// that-clause, or the back half of a date isn't severed from its condition.
// Nine real bill sentences (H1006, H1064, H1054, H1000, H1037, H1074),
// Groups A (must not change) and B (must now keep the full condition) and C
// (", in which case ..." deliberately ends the condition rather than being
// captured or silently merged into an unrelated clause).
// Usage: node scripts/test-condition-clause-boundary.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/condition-clause-boundary-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence);
  const conditions = units.flatMap((u) => u.parse.what.conditions || []);
  const joined = conditions.join(" ||| ").toLowerCase();

  const failures = [];

  if (conditions.length !== c.expectedConditionCount) {
    failures.push(`expected ${c.expectedConditionCount} condition(s), got ${conditions.length}`);
  }

  for (const substr of c.conditionContains || []) {
    if (!conditions.some((cond) => cond.toLowerCase().includes(substr.toLowerCase()))) {
      failures.push(`no condition contains: "${substr}"`);
    }
  }

  for (const substr of c.conditionMustNotContain || []) {
    if (joined.includes(substr.toLowerCase())) {
      failures.push(`a condition unexpectedly contains: "${substr}"`);
    }
  }

  if (failures.length === 0) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    failures.forEach((f) => console.log(`  ${f}`));
    console.log(`  conditions: ${JSON.stringify(conditions)}`);
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
process.exit(failCount > 0 ? 1 : 0);
