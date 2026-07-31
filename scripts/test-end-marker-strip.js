#!/usr/bin/env node
// Regression suite for stripEndMarker (api/wa-bill-text.js) — confirms the
// Washington Legislature's own "--- END ---" end-of-document banner is
// removed from the tail of extracted bill text without eating real content:
// a sentence that merely contains the word "end", a mid-document occurrence
// (not expected in real files, but proves the strip is anchored to
// end-of-document rather than a bare global match), and text with no
// marker at all all survive untouched.
// Usage: node scripts/test-end-marker-strip.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripEndMarker } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/wa/end-marker-strip-test-cases.json");
const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));

let passCount = 0;
let failCount = 0;

for (const c of cases) {
  const actual = stripEndMarker(c.input);
  if (actual === c.expected) {
    passCount++;
    console.log(`PASS  ${c.id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${c.id}`);
    console.log(`  expected: ${JSON.stringify(c.expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// Real-text check: the tail of HB 1111's extracted text (the exact anchor
// shape from the bug report), asserting the marker is gone and the real
// content immediately before it survives.
{
  const id = "hb-1111-real-tail-marker-absent-content-present";
  const hb1111Tail =
    "...to petition the indeterminate sentence review board for early release " +
    "under this act, who otherwise would not be eligible. This act may be known " +
    "and cited as the youth hope act. --- END ---.";
  const result = stripEndMarker(hb1111Tail);
  const failures = [];
  if (result.includes("END")) failures.push(`"--- END ---" still present: ${JSON.stringify(result)}`);
  if (!result.includes("youth hope act")) failures.push(`"youth hope act" missing: ${JSON.stringify(result)}`);

  if (failures.length === 0) {
    passCount++;
    console.log(`PASS  ${id}`);
  } else {
    failCount++;
    console.log(`FAIL  ${id}`);
    failures.forEach((f) => console.log(`  ${f}`));
  }
}

console.log(`\n${passCount} passed, ${failCount} failed, ${passCount + failCount} total.`);
process.exit(failCount > 0 ? 1 : 0);
