#!/usr/bin/env node
// Regression suite for the value-term delegation detector (Case 3 of the
// value-term / applicability-modifiers layer) — confirms real bill sentences
// that hand a value term to a named authority's judgment or rulemaking are
// flagged as delegated with the right value term and holder, and confirms
// external references, bare values, and functional adjectives are not
// mistaken for delegation.
// Usage: node scripts/test-value-delegation.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/value-delegation-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence);
  const actualFindings = units.flatMap((u) => u.tetherAnchor.valueResolution || []);

  const failures = [];

  if (actualFindings.length !== c.expectedFindings.length) {
    failures.push(
      `expected ${c.expectedFindings.length} finding(s), got ${actualFindings.length}: ${JSON.stringify(actualFindings)}`
    );
  }

  for (const expected of c.expectedFindings) {
    const match = actualFindings.find((f) =>
      f.valueTerm.toLowerCase().includes(expected.valueTermContains.toLowerCase())
    );
    if (!match) {
      failures.push(`no finding with valueTerm containing "${expected.valueTermContains}"`);
      continue;
    }
    if (match.resolutionState !== expected.resolutionState) {
      failures.push(
        `finding "${match.valueTerm}": expected resolutionState "${expected.resolutionState}", got ${JSON.stringify(match.resolutionState)}`
      );
    }
    if (expected.resolutionHolderContains !== undefined) {
      const holder = match.resolutionHolder || "";
      if (!holder.toLowerCase().includes(expected.resolutionHolderContains.toLowerCase())) {
        failures.push(
          `finding "${match.valueTerm}": expected resolutionHolder to contain "${expected.resolutionHolderContains}", got ${JSON.stringify(holder)}`
        );
      }
    }
    if (expected.cueContains !== undefined) {
      const cue = match.cue || "";
      if (!cue.toLowerCase().includes(expected.cueContains.toLowerCase())) {
        failures.push(
          `finding "${match.valueTerm}": expected cue to contain "${expected.cueContains}", got ${JSON.stringify(cue)}`
        );
      }
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
