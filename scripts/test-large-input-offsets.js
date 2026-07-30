#!/usr/bin/env node
// Regression suite for the offset-spread stack-overflow crash — confirms a
// large bill's text (~134,000+ characters) no longer throws "Maximum call
// stack size exceeded" when stripGlobal or stripMidSubsectionMarkers builds
// its offsets array. Two real bills (HB 1216, 686 KB; HB 1227, 236 KB)
// threw and rendered nothing before this fix, because offsets.push(...slice)
// spread every element of a large array as its own function argument.
//
// Does NOT commit a large bill fixture — a 686 KB file doesn't belong in
// the repo. The input is generated programmatically instead, which
// reproduces the exact failure mode (a large leading slice reaching a
// strikeout marker or a subsection marker) while keeping the repo clean.
//
// Usage: node scripts/test-large-input-offsets.js

import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const FILLER_SENTENCE = "The department must submit a report to the appropriate committees. ";

function buildFiller(minLength) {
  let text = "";
  while (text.length < minLength) text += FILLER_SENTENCE;
  return text;
}

let passCount = 0;
let failCount = 0;

function runCase(id, sentence, { expectUnits = true } = {}) {
  let units = null;
  let threw = null;
  try {
    ({ units } = runPipeline(sentence));
  } catch (err) {
    threw = err;
  }

  const failures = [];
  if (threw) {
    failures.push(`threw: ${threw.message}`);
  } else if (expectUnits && (!units || units.length === 0)) {
    failures.push(`expected a non-empty units array, got ${JSON.stringify(units)}`);
  }

  if (failures.length === 0) {
    passCount++;
    console.log(`PASS  ${id}${units ? ` (${units.length} units, ${sentence.length} chars)` : ""}`);
  } else {
    failCount++;
    console.log(`FAIL  ${id}`);
    failures.forEach((f) => console.log(`  ${f}`));
  }
}

// Case 1: reproduces the confirmed crash site — stripGlobal(STRIKEOUT_RE).
// A large leading slice (~134,000+ characters) precedes a "(( ... ))"
// strikeout marker, so the strip step's offsets.push builds a huge array in
// one call.
const strikeoutInput = `${buildFiller(134000)}The board (( shall )) must adopt rules.`;
runCase("large-input-strikeout-strip-does-not-crash", strikeoutInput);

// Case 2: same defect class in stripMidSubsectionMarkers — a large leading
// slice precedes a mid-text subsection marker ("(5)") after a sentence
// boundary. Not one of the two confirmed-crashing bills, but the identical
// pattern, fixed together per the task.
const subsectionInput = `${buildFiller(134000)}(5) The board must adopt rules.`;
runCase("large-input-subsection-marker-strip-does-not-crash", subsectionInput);

// Case 3: small-input control (~33,000 characters) — confirmed NOT to crash
// even before this fix, documenting that the defect is size-dependent
// rather than a logic error in the parser.
const smallInput = `${buildFiller(33000)}The board (( shall )) must adopt rules.`;
runCase("small-input-control-normal-behavior", smallInput);

console.log(`\n${passCount} passed, ${failCount} failed, ${passCount + failCount} total.`);
process.exit(failCount > 0 ? 1 : 0);
