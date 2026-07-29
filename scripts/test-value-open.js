#!/usr/bin/env node
// Regression suite for the value-term "open" detector (Case 4 of the
// value-term / applicability-modifiers layer) — confirms real bill sentences
// that command a value term without ever resolving it are flagged as open,
// and confirms a term Case 3 already resolved, a functional adjective, and
// an external-citation resolution are not mistaken for open.
// Usage: node scripts/test-value-open.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/value-open-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence);
  const allFindings = units.flatMap((u) => u.tetherAnchor.valueResolution || []);
  // Assert on OPEN findings specifically, so a negative that legitimately
  // carries a Case 3 "delegated" finding still passes with zero open ones.
  const actualOpen = allFindings.filter((f) => f.resolutionState === "open");

  const failures = [];

  if (actualOpen.length !== c.expectedOpenFindings.length) {
    failures.push(
      `expected ${c.expectedOpenFindings.length} open finding(s), got ${actualOpen.length}: ${JSON.stringify(actualOpen)}`
    );
  }

  for (const expected of c.expectedOpenFindings) {
    const match = actualOpen.find((f) =>
      f.valueTerm.toLowerCase().includes(expected.valueTermContains.toLowerCase())
    );
    if (!match) {
      failures.push(`no open finding with valueTerm containing "${expected.valueTermContains}"`);
      continue;
    }
    if (match.resolutionHolder !== null) {
      failures.push(`finding "${match.valueTerm}": expected resolutionHolder null, got ${JSON.stringify(match.resolutionHolder)}`);
    }
    if (match.cue !== null) {
      failures.push(`finding "${match.valueTerm}": expected cue null, got ${JSON.stringify(match.cue)}`);
    }
  }

  if (failures.length === 0) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    failures.forEach((f) => console.log(`  ${f}`));
    units.forEach((u, i) => {
      console.log(`  unit ${i}: valueResolution=${JSON.stringify(u.tetherAnchor.valueResolution)}`);
    });
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
process.exit(failCount > 0 ? 1 : 0);
