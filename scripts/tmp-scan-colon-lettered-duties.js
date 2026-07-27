#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Validation run #1: discovery sweep for sentences where a colon introduces
// a list of lettered/numbered items -- (a), (b), (1), (2), (i), (ii) -- and
// one or more items carries its own actor, action, or force-word rather
// than just completing the lead-in sentence. Raw output only -- no design,
// no fixes, no pipeline changes. Same 212-bill sample as prior
// discovery/validation rounds, for comparability; sampling code copied
// verbatim from scripts/tmp-scan-nonduty-categories.js (git history).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(__dirname, "../tmp-scan-colon-lettered-duties-results.txt");

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

const out = [];
const log = (line = "") => out.push(line);

log(`Bill count in this run's sample: ${batch.length} (expected 212)`);
if (batch.length !== 212) {
  log(`STOP: sample count is ${batch.length}, not 212. Not proceeding with the scan.`);
  writeFileSync(OUTPUT_FILE, out.join("\n"));
  console.log(out.join("\n"));
  process.exit(0);
}
log(`Pool size (excluding sentinels, no-document bills, and 4000-4999/8000-8999 ranges): ${pool.length}`);
log(`Sampling every ${step} bills: ${batch.join(", ")}\n`);

function singleLine(s) {
  return s.replace(/\s+/g, " ").trim();
}

// ─── Colon + lettered/numbered item list detection ─────────────────────────

const MARKER_RE = /\(([a-z]{1,3}|[ivxlcdm]{1,5}|\d{1,3})\)/gi;
const FORCE_RE = /\b(shall|must|may|will)\b/i;
const DEFINITION_LEADIN_RE = /\bmeans?\s*(the\s+following)?$/i;
const FACTOR_KEYWORDS_RE = /\b(consider(ing)?|factors?|criteria|weigh(ing)?|in\s+determining)\b/i;
const MAX_GAP = 600; // max chars between consecutive item markers before we consider the list ended
const MAX_TOTAL = 6000; // hard cap on total scanned list length

function findColonListMatches(text) {
  const allMarkers = [...text.matchAll(MARKER_RE)].map((m) => ({
    marker: m[1], index: m.index, end: m.index + m[0].length,
  }));
  const colonPositions = [...text.matchAll(/:/g)].map((m) => m.index);
  const results = [];

  for (const colonIdx of colonPositions) {
    const afterColon = text.slice(colonIdx + 1, colonIdx + 8);
    const firstMarkerMatch = afterColon.match(/^(\s{0,3})(\((?:[a-z]{1,3}|[ivxlcdm]{1,5}|\d{1,3})\))/i);
    if (!firstMarkerMatch) continue;
    const firstMarkerGlobalIndex = colonIdx + 1 + firstMarkerMatch[1].length;
    const idx = allMarkers.findIndex((m) => m.index === firstMarkerGlobalIndex);
    if (idx === -1) continue;

    const items = [allMarkers[idx]];
    let prevEnd = allMarkers[idx].end;
    for (let j = idx + 1; j < allMarkers.length; j++) {
      const m = allMarkers[j];
      if (m.index - prevEnd > MAX_GAP) break;
      if (m.index - firstMarkerGlobalIndex > MAX_TOTAL) break;
      items.push(m);
      prevEnd = m.end;
    }
    if (items.length < 2) continue;

    let endIdx = prevEnd;
    const tail = text.slice(endIdx, endIdx + 2000);
    const sentEndMatch = tail.match(/\.(?=\s+[A-Z"(]|\s*$)/);
    endIdx = sentEndMatch ? endIdx + sentEndMatch.index + 1 : endIdx + Math.min(tail.length, 500);

    const before = text.slice(0, colonIdx);
    const leadStartMatches = [...before.matchAll(/[.!?]\s+(?=[A-Z"(])/g)];
    const leadStartMatch = leadStartMatches[leadStartMatches.length - 1];
    const leadStart = leadStartMatch ? leadStartMatch.index + leadStartMatch[0].length : 0;

    const fullText = text.slice(leadStart, endIdx).trim();
    const leadIn = text.slice(leadStart, colonIdx).trim();

    results.push({ leadIn, items, fullText, colonIdx, endIdx });
  }
  return results;
}

function itemTexts(text, items, endIdx) {
  const out2 = [];
  for (let i = 0; i < items.length; i++) {
    const start = items[i].end;
    const end = i + 1 < items.length ? items[i + 1].index : endIdx;
    out2.push(text.slice(start, end).trim());
  }
  return out2;
}

function forceWordIn(s) {
  const m = s.match(FORCE_RE);
  return m ? m[1].toLowerCase() : null;
}

function joinWordBeforeMarker(text, markerIndex) {
  const window = text.slice(Math.max(0, markerIndex - 15), markerIndex);
  if (/\band\b\s*$/i.test(window)) return "and";
  if (/\bor\b\s*$/i.test(window)) return "or";
  return "none";
}

function hasNestedList(itemStr) {
  return /:\s*\(([a-z]{1,3}|[ivxlcdm]{1,5}|\d{1,3})\)/i.test(itemStr);
}

function classify(leadIn, itemStrs) {
  if (DEFINITION_LEADIN_RE.test(leadIn)) return { label: "DEFINITION-LIST", reason: "lead-in ends in 'means'/'means the following'" };
  const itemForce = itemStrs.map(forceWordIn);
  const withForce = itemForce.filter(Boolean);
  if (withForce.length === 0) {
    if (FACTOR_KEYWORDS_RE.test(leadIn)) return { label: "FACTOR-LIST", reason: "lead-in references factors/criteria/considering, no item has its own force-word" };
    if (FORCE_RE.test(leadIn)) return { label: "SHARED-DUTY", reason: "lead-in has a force-word, no item restates its own" };
    return { label: "OTHER", reason: "no force-word anywhere (lead-in or items) -- describe manually" };
  }
  if (withForce.length === itemForce.length && itemForce.length >= 2) {
    return { label: "EACH-ITEM-OWN-FORCE", reason: "every item states its own force-word" };
  }
  return { label: "MIXED", reason: `${withForce.length} of ${itemForce.length} items state their own force-word, others do not` };
}

// ─── Main scan ──────────────────────────────────────────────────────────────

const seen = new Map(); // fullText -> { first match record, occurrences: [] }
let billsFetchedOk = 0;
let totalRawMatches = 0;

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
    const text = singleLine(section.text);
    const matches = findColonListMatches(text);
    for (const m of matches) {
      totalRawMatches++;
      const items = itemTexts(text, m.items, m.endIdx);
      const itemForce = items.map(forceWordIn);
      const leadForce = forceWordIn(m.leadIn);
      const cls = classify(m.leadIn, items);
      const joinWords = m.items.map((mk) => joinWordBeforeMarker(text, mk.index));
      const lastJoinWord = joinWords[joinWords.length - 1];
      const nested = items.map(hasNestedList);

      const key = m.fullText;
      if (seen.has(key)) {
        seen.get(key).occurrences.push({ bill: billNumber, section: section.id });
        continue;
      }
      seen.set(key, {
        occurrences: [{ bill: billNumber, section: section.id }],
        fullText: m.fullText,
        leadIn: m.leadIn,
        leadForce,
        items,
        itemForce,
        markers: m.items.map((mk) => mk.marker),
        joinWords,
        lastJoinWord,
        nested,
        classification: cls,
      });
    }
  }
}

log(`Bills fetched OK: ${billsFetchedOk} / ${batch.length}`);
log(`Total raw colon+lettered-item matches (with duplicates across bills): ${totalRawMatches}`);
log(`Distinct sentences after dedup: ${seen.size}\n`);

const all = [...seen.values()];
const byClass = {};
for (const r of all) {
  byClass[r.classification.label] = (byClass[r.classification.label] || 0) + 1;
}
log(`─── Breakdown by classification ───`);
for (const [label, count] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
  log(`${label}: ${count}`);
}
log("");

function printRecord(r, i) {
  log(`[${i}] Occurrences: ${r.occurrences.map((o) => `bill ${o.bill}/${o.section}`).join("; ")}`);
  log(`  FULL TEXT: ${r.fullText}`);
  log(`  LEAD-IN: ${r.leadIn}`);
  log(`  LEAD-IN FORCE-WORD: ${r.leadForce || "none"}`);
  log(`  MARKERS: ${r.markers.map((m) => `(${m})`).join(" ")}`);
  r.items.forEach((it, idx) => {
    log(`    ITEM ${r.markers[idx]}: force=${r.itemForce[idx] || "none"} join-before=${r.joinWords[idx]} nested=${r.nested[idx]} -- ${it}`);
  });
  log(`  LAST-ITEM JOIN WORD: ${r.lastJoinWord}`);
  log(`  CLASSIFICATION: ${r.classification.label} (${r.classification.reason})`);
  log("");
}

log(`─── EACH-ITEM-OWN-FORCE and MIXED, in full ───\n`);
const priority = all.filter((r) => r.classification.label === "EACH-ITEM-OWN-FORCE" || r.classification.label === "MIXED");
priority.forEach((r, i) => printRecord(r, i + 1));
if (!priority.length) log("(none found)\n");

for (const label of ["SHARED-DUTY", "DEFINITION-LIST", "FACTOR-LIST"]) {
  log(`─── Representative sample of ${label} (up to 15) ───\n`);
  const sample = all.filter((r) => r.classification.label === label).slice(0, 15);
  sample.forEach((r, i) => printRecord(r, i + 1));
  if (!sample.length) log("(none found)\n");
}

log(`─── OTHER, in full ───\n`);
const others = all.filter((r) => r.classification.label === "OTHER");
others.forEach((r, i) => printRecord(r, i + 1));
if (!others.length) log("(none found)\n");

log(`─── Nested colon-lists (an item's own text contains another colon+marker sequence) ───\n`);
const withNesting = all.filter((r) => r.nested.some(Boolean));
withNesting.forEach((r, i) => printRecord(r, i + 1));
if (!withNesting.length) log("(none found)\n");

log(`─── Cases where the last item's joining word is missing or inconsistent ───\n`);
const joinIssues = all.filter((r) => {
  const nonLast = r.joinWords.slice(0, -1);
  const hasInconsistency = r.lastJoinWord === "none" || nonLast.some((w) => w !== "none");
  return hasInconsistency;
});
joinIssues.forEach((r, i) => printRecord(r, i + 1));
if (!joinIssues.length) log("(none found)\n");

log(`─── Control check: sentences with no force-word ambiguity (SHARED-DUTY, no independent item force) ───`);
log(`Count: ${byClass["SHARED-DUTY"] || 0}`);
const controlSample = all.filter((r) => r.classification.label === "SHARED-DUTY").slice(0, 3);
controlSample.forEach((r, i) => {
  log(`Example ${i + 1}: ${r.fullText}`);
});
log("");

writeFileSync(OUTPUT_FILE, out.join("\n"));
console.log(out.join("\n"));
