import assert from "node:assert/strict";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";
import { renderISC } from "../lib/plain-meaning/renderer.js";

// HB 2108 (2025–26). Use a lead-in so the trace must locate a nonzero offset.
const duty = "The tool must be designed to limit bias related to race, ethnicity, gender, and age.";
const leadIn = "The department must publish the criteria. ";
const source = leadIn + duty;
const { plainMeaning, sentences } = renderISC(runPipeline(source), { debug: true });

assert.ok(plainMeaning.includes(duty), "Plain meaning must retain the full duty");
const renderedDuty = sentences.find(({ sentence }) => sentence === duty);
assert.ok(renderedDuty, "The duty must have its own rendered sentence");
const span = renderedDuty.trace?.sourceSpan;
assert.ok(span, "The rendered duty must have a source span");
assert.equal(span.locateFailed, false);
assert.deepEqual(span.position, [leadIn.length, source.length]);
assert.equal(span.text, duty);
assert.equal(source.slice(...span.position), duty);

console.log("PASS HB 2108 duty renders and traces to its exact source span");
