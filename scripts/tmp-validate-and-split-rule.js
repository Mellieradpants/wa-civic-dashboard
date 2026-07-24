#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Validation run #1 for a candidate rule: split a sentence's duties at an
// "and" (optionally preceded by , or ;) immediately followed by a force-word
// (shall/must/may, "will" excluded), with a fail-safe that refuses to split
// if either resulting side is empty or effectively empty. Applies the rule
// exactly as specified to real bill text and a control group that must NOT
// split. Raw output only — no design, no fixes, no pipeline changes.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(__dirname, "../tmp-validation-run1-results.txt");

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const excludedNumbers = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);
const pool = [...new Set(
  BILL_INDEX.map(b => Number(b.bill_number))
    .filter(n => !excludedNumbers.has(n))
    .filter(n => !(n >= 4000 && n <= 4999))
    .filter(n => !(n >= 8000 && n <= 8999))
)].sort((a, b) => a - b);

const step = Math.max(1, Math.floor(pool.length / SAMPLE_SIZE));
const batch = [];
for (let i = 0; i < pool.length; i += step) batch.push(pool[i]);

function splitSentences(text) {
  return text
    .split(/(?<=[.!?;])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// ─── Fail-safe emptiness check — mirrors isEffectivelyEmptyAction in pipeline.js ───

const CONNECTIVE_WORDS = new Set([
  "and", "or", "but", "the", "a", "an", "to", "of", "in", "on", "for",
  "with", "by", "as", "at", "from", "this", "that", "it", "its",
  "be", "been", "is", "are", "was", "were",
]);

function isEffectivelyEmptyAction(action) {
  if (!action) return true;
  const stripped = action.replace(/[.,;:()\-–—]/g, " ").trim();
  if (!stripped) return true;
  const words = stripped.split(/\s+/).filter(Boolean);
  return words.every((w) => CONNECTIVE_WORDS.has(w.toLowerCase()));
}

// ─── The candidate rule's trigger ───────────────────────────────────────────
// "and" (optionally preceded by , or ;) immediately followed by a force-word
// (shall/must/may), optionally followed by "not". "will" is never a trigger.

const TRIGGER_RE = /([,;]\s*)?\band\b\s+(shall|must|may)\b(\s+not\b)?/gi;

function findTriggers(sentence) {
  return [...sentence.matchAll(TRIGGER_RE)].map((m) => ({
    index: m.index,
    endIndex: m.index + m[0].length,
    force: m[2].toLowerCase(),
    negation: !!m[3],
    raw: m[0],
  }));
}

function detectLeadingForce(text) {
  const m = text.match(/\b(shall|must|may|will|should)\b(\s+not\b)?/i);
  if (!m) return { force: null, negation: false };
  return { force: m[1].toLowerCase(), negation: !!m[2] };
}

// ─── Nested-clause guard (measured only, not implemented as a rule) ────────
// Records whether a relative pronoun sits between the previous force-word
// and this trigger, with no intervening comma.

const PREV_FORCE_RE = /\b(shall|must|may|will|should)\b/gi;
const RELATIVE_PRONOUN_RE = /\b(who|whom|whose|that|which)\b/i;

function guardCheck(sentence, triggerIndex) {
  const before = sentence.slice(0, triggerIndex);
  let lastEnd = -1;
  for (const m of before.matchAll(PREV_FORCE_RE)) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1) return { applicable: false, hit: false };
  const between = sentence.slice(lastEnd, triggerIndex);
  const hasRelative = RELATIVE_PRONOUN_RE.test(between);
  const hasComma = between.includes(",");
  return { applicable: true, hit: hasRelative && !hasComma, between };
}

// ─── Control group patterns — must NOT split ───────────────────────────────

const CONTROL_PATTERNS = [
  {
    name: "NEAR_MISS_WITHIN_3_WORDS",
    // "and" then 1-3 non-force words then a force-word (not immediate)
    re: /\band\b\s+(?:(?!(?:shall|must|may|will)\b)\S+\s+){1,3}(?:shall|must|may)\b/i,
  },
  {
    name: "AND_COMMA_AS_MAY",
    re: /\band,\s*as\s+may\b/i,
  },
  {
    name: "AS_MAY_BE",
    re: /\bas may be\b/i,
  },
  {
    name: "AND_WILL",
    re: /\band will\b/i,
  },
  {
    name: "AND_MAY_BE_PASSIVE",
    re: /\band may be\b/i,
  },
];

function matchedControlFamilies(sentence) {
  const matched = [];
  for (const { name, re } of CONTROL_PATTERNS) {
    if (re.test(sentence)) matched.push(name);
  }
  return matched;
}

// ─── Apply the candidate rule to one sentence ──────────────────────────────

function applyRule(sentence) {
  const triggers = findTriggers(sentence);
  const triggerRecords = [];
  const duties = [];
  let currentStart = 0;
  let pendingForce = null; // force info for the duty starting at currentStart; null = detect it
  let splitsPerformed = 0;
  let failSafeSuppressions = 0;
  let guardHits = 0;
  const forcePairs = [];
  let previousDutyForceLabel = null;

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    const duty1Candidate = sentence.slice(currentStart, trigger.index).trim();
    const nextBoundary = i + 1 < triggers.length ? triggers[i + 1].index : sentence.length;
    const duty2Candidate = sentence.slice(trigger.endIndex, nextBoundary).trim();

    const guard = guardCheck(sentence, trigger.index);
    if (guard.hit) guardHits++;

    const isDuty1Empty = isEffectivelyEmptyAction(duty1Candidate);
    const isDuty2Empty = isEffectivelyEmptyAction(duty2Candidate);

    if (isDuty1Empty || isDuty2Empty) {
      failSafeSuppressions++;
      triggerRecords.push({
        trigger, guard, decision: "suppressed-failsafe",
        duty1Candidate, duty2Candidate, isDuty1Empty, isDuty2Empty,
      });
      continue;
    }

    // Finalize the duty ending at this trigger.
    const finalizedForce = pendingForce || detectLeadingForce(duty1Candidate);
    duties.push({ text: duty1Candidate, force: finalizedForce.force, negation: finalizedForce.negation });

    const beforeLabel = previousDutyForceLabel || (finalizedForce.force ? `${finalizedForce.force}${finalizedForce.negation ? "_not" : ""}` : "UNKNOWN");
    const afterLabel = `${trigger.force}${trigger.negation ? "_not" : ""}`;
    forcePairs.push(`${beforeLabel} -> ${afterLabel}`);
    previousDutyForceLabel = afterLabel;

    triggerRecords.push({
      trigger, guard, decision: "split",
      duty1Candidate, duty2Candidate, isDuty1Empty, isDuty2Empty,
    });

    currentStart = trigger.endIndex;
    pendingForce = { force: trigger.force, negation: trigger.negation };
    splitsPerformed++;
  }

  const finalText = sentence.slice(currentStart).trim();
  const finalForce = pendingForce || detectLeadingForce(finalText);
  duties.push({ text: finalText, force: finalForce.force, negation: finalForce.negation });

  return { triggers, triggerRecords, duties, splitsPerformed, failSafeSuppressions, guardHits, forcePairs };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const out = [];
const log = (line = "") => out.push(line);

log(`Pool size (excluding sentinels, no-document bills, and 4000-4999/8000-8999 ranges): ${pool.length}`);
log(`Sampling every ${step} bills, ${batch.length} bills total: ${batch.join(", ")}\n`);

const seen = new Map();
let billsFetchedOk = 0;
let candidateCount = 0;

for (const billNumber of batch) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), BIENNIUM);
  } catch (err) {
    log(`Bill ${billNumber}: SKIP — ${err.message}`);
    continue;
  }
  billsFetchedOk++;
  for (const section of data.sections || []) {
    if (!section.text?.trim()) continue;
    for (const sentence of splitSentences(section.text)) {
      const controlFamilies = matchedControlFamilies(sentence);
      const hasTrigger = TRIGGER_RE.test(sentence);
      TRIGGER_RE.lastIndex = 0;
      if (!hasTrigger && controlFamilies.length === 0) continue;
      candidateCount++;
      if (seen.has(sentence)) {
        seen.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        continue;
      }
      const result = applyRule(sentence);
      seen.set(sentence, {
        controlFamilies,
        isControlGroup: controlFamilies.length > 0,
        result,
        occurrences: [{ bill: billNumber, section: section.id }],
      });
    }
  }
}

log(`Total candidate sentences (with duplicates): ${candidateCount}`);
log(`Distinct sentences after dedup: ${seen.size}\n`);

const singleLine = (s) => s.replace(/\s+/g, " ").trim();

let totalSplits = 0;
let totalFailSafe = 0;
let totalGuardHits = 0;
let sentencesWithGuardHit = 0;
const forcePairCounts = {};
const controlGroupSplitEntries = [];

let idx = 0;
for (const [sentence, { controlFamilies, isControlGroup, result, occurrences }] of seen.entries()) {
  idx++;
  const { triggers, triggerRecords, duties, splitsPerformed, failSafeSuppressions, guardHits, forcePairs } = result;

  totalSplits += splitsPerformed;
  totalFailSafe += failSafeSuppressions;
  totalGuardHits += guardHits;
  if (guardHits > 0) sentencesWithGuardHit++;
  for (const pair of forcePairs) {
    forcePairCounts[pair] = (forcePairCounts[pair] || 0) + 1;
  }
  if (isControlGroup && splitsPerformed > 0) {
    controlGroupSplitEntries.push({ sentence, controlFamilies, result, occurrences });
  }

  const firstOcc = occurrences[0];
  const dupNote = occurrences.length > 1
    ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  const controlLabel = isControlGroup ? `control=[${controlFamilies.join(",")}]` : "control=none";

  log(`--- RESULT ${idx} — bill ${firstOcc.bill}, section ${firstOcc.section}, triggers=${triggers.length}, splits=${splitsPerformed}, failsafe_suppressed=${failSafeSuppressions}, guard_hit=${guardHits > 0}, ${controlLabel}${dupNote} ---`);
  log(`sentence: ${singleLine(sentence)}`);
  for (const tr of triggerRecords) {
    log(`  trigger @${tr.trigger.index} "${tr.trigger.raw.trim()}" force=${tr.trigger.force}${tr.trigger.negation ? "_not" : ""} decision=${tr.decision} guard_applicable=${tr.guard.applicable} guard_hit=${tr.guard.hit}`);
    log(`    side1: ${singleLine(tr.duty1Candidate)} ${tr.isDuty1Empty ? "[EMPTY]" : ""}`);
    log(`    side2: ${singleLine(tr.duty2Candidate)} ${tr.isDuty2Empty ? "[EMPTY]" : ""}`);
  }
  log(`  resulting duties (${duties.length}):`);
  duties.forEach((d, i) => {
    const forceLabel = d.force ? `${d.force}${d.negation ? "_not" : ""}` : "UNKNOWN";
    log(`    duty ${i + 1} [${forceLabel}]: ${singleLine(d.text)}`);
  });
  log("");
}

log("\nSummary:");
log(`  total distinct sentences: ${seen.size}`);
log(`  total splits performed: ${totalSplits}`);
log(`  total fail-safe suppressions: ${totalFailSafe}`);
log(`  total nested-clause-guard hits (per trigger): ${totalGuardHits}`);
log(`  distinct sentences with at least one guard hit: ${sentencesWithGuardHit}`);
log(`\nForce-word pair breakdown (first duty force -> second duty force), per split event:`);
for (const [pair, count] of Object.entries(forcePairCounts).sort((a, b) => b[1] - a[1])) {
  log(`  ${pair}: ${count}`);
}

log(`\n\n=== CONTROL GROUP sentences where a split occurred — FALSE POSITIVES (${controlGroupSplitEntries.length}) ===\n`);
controlGroupSplitEntries.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  const dupNote = entry.occurrences.length > 1
    ? ` [appeared in ${entry.occurrences.length} places: ${entry.occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  log(`--- CONTROL-SPLIT ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}, control=[${entry.controlFamilies.join(",")}], splits=${entry.result.splitsPerformed}${dupNote} ---`);
  log(`sentence: ${singleLine(entry.sentence)}`);
  entry.result.duties.forEach((d, i2) => {
    const forceLabel = d.force ? `${d.force}${d.negation ? "_not" : ""}` : "UNKNOWN";
    log(`  duty ${i2 + 1} [${forceLabel}]: ${singleLine(d.text)}`);
  });
  log("");
});

log(`\nDone. ${batch.length} bills sampled, ${billsFetchedOk} bills fetched successfully, ${candidateCount} candidate sentences found (with duplicates), ${seen.size} distinct sentences classified, ${totalSplits} total splits, ${totalFailSafe} fail-safe suppressions, ${controlGroupSplitEntries.length} control-group false positives.`);

writeFileSync(OUTPUT_FILE, out.join("\n"), "utf8");

console.log(`Pool size: ${pool.length}, sampled ${batch.length} bills, ${billsFetchedOk} fetched ok.`);
console.log(`Distinct candidate sentences: ${seen.size}. Total splits: ${totalSplits}. Fail-safe suppressions: ${totalFailSafe}.`);
console.log(`Control-group false positives (splits that should not have happened): ${controlGroupSplitEntries.length}.`);
console.log(`Full results written to ${OUTPUT_FILE}`);
