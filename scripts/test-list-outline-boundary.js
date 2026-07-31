#!/usr/bin/env node
// Regression suite for the list outline-level boundary fix — confirms a
// numbered marker ("(2)") following a lettered/roman list ("(a)"/"(b)") is
// recognized as a new subsection, not a continuation of that list, so a
// provision with no modal of its own (e.g. an expiration date) is never
// welded onto the preceding duty as an invented obligation. Also confirms
// every other list-binding shape this touches is unaffected: a same-level
// lettered continuation, a numbered continuation of a numbered list, and an
// ordinary following sentence with its own duty (with or without its own
// marker).
// Usage: node scripts/test-list-outline-boundary.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/list-outline-boundary-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const { units } = runPipeline(c.sentence);
  const dumpText = JSON.stringify(units.map((u) => {
    const { lineage, ...rest } = u;
    return rest;
  }));

  const failures = [];

  if (typeof c.minUnitCount === "number" && units.length < c.minUnitCount) {
    failures.push(`expected at least ${c.minUnitCount} unit(s), got ${units.length}`);
  }
  if (typeof c.maxUnitCount === "number" && units.length > c.maxUnitCount) {
    failures.push(`expected at most ${c.maxUnitCount} unit(s), got ${units.length}`);
  }

  for (const word of c.mustContainWords || []) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(dumpText)) failures.push(`missing required content: "${word}"`);
  }

  for (const word of c.mustNotContainWords || []) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(dumpText)) failures.push(`forbidden content present: "${word}"`);
  }

  for (const check of c.unitChecks || []) {
    const unit = units[check.index];
    if (!unit) {
      failures.push(`unitChecks[${check.index}]: no unit at that index (only ${units.length} produced)`);
      continue;
    }
    if (check.modal !== undefined && unit.parse.who.modal !== check.modal) {
      failures.push(`unit ${check.index}: expected modal "${check.modal}", got ${JSON.stringify(unit.parse.who.modal)}`);
    }
    if (check.actorContains !== undefined) {
      const actor = unit.parse.who.responsibleParty || "";
      if (!actor.toLowerCase().includes(check.actorContains.toLowerCase())) {
        failures.push(`unit ${check.index}: expected actor to contain "${check.actorContains}", got ${JSON.stringify(actor)}`);
      }
    }
    if (check.actionContains !== undefined) {
      const action = unit.parse.what.action || "";
      if (!action.toLowerCase().includes(check.actionContains.toLowerCase())) {
        failures.push(`unit ${check.index}: expected action to contain "${check.actionContains}", got ${JSON.stringify(action)}`);
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
      console.log(`  unit ${i}: actor=${JSON.stringify(u.parse.who.responsibleParty)} modal=${JSON.stringify(u.parse.who.modal)} action=${JSON.stringify(u.parse.what.action)}`);
    });
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${cases.length} total.`);
process.exit(failCount > 0 ? 1 : 0);
