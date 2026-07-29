#!/usr/bin/env node
// Regression suite for the value-term "internal" detector (Case 1 of the
// value-term / applicability-modifiers layer) — confirms real bill
// definition sentences that define a value term themselves are flagged as
// internal, and confirms a technical/financial homograph, an
// external-pointer definition body, and an ordinary duty use are not
// mistaken for an internal definition.
// Usage: node scripts/test-value-internal.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/value-internal-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence);
  const allFindings = units.flatMap((u) => u.tetherAnchor.valueResolution || []);
  // Assert on INTERNAL findings specifically, so a duty-use negative that
  // legitimately carries a Case 4 "open" finding still passes with zero
  // internal ones.
  const actualInternal = allFindings.filter((f) => f.resolutionState === "internal");

  const failures = [];

  if (actualInternal.length !== c.expectedInternalFindings.length) {
    failures.push(
      `expected ${c.expectedInternalFindings.length} internal finding(s), got ${actualInternal.length}: ${JSON.stringify(actualInternal)}`
    );
  }

  for (const expected of c.expectedInternalFindings) {
    const match = actualInternal.find((f) =>
      f.valueTerm.toLowerCase().includes(expected.valueTermContains.toLowerCase())
    );
    if (!match) {
      failures.push(`no internal finding with valueTerm containing "${expected.valueTermContains}"`);
      continue;
    }
    if (match.resolutionHolder !== null) {
      failures.push(`finding "${match.valueTerm}": expected resolutionHolder null, got ${JSON.stringify(match.resolutionHolder)}`);
    }
    if (match.cue !== "means") {
      failures.push(`finding "${match.valueTerm}": expected cue "means", got ${JSON.stringify(match.cue)}`);
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
