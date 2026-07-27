#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Measures how often the production pipeline (runPipeline, unmodified,
// exactly as it exists on main) silently drops a colon-lettered list
// item's content entirely -- not merged, not summarized, absent from
// every unit the pipeline produces for that section.
//
// Boundary detection and classification (candidate-list gate, NOT-A-LIST,
// SHARED-DUTY/MIXED/EACH-ITEM-OWN-FORCE/FACTOR-LIST/DEFINITION-LIST) are
// copied verbatim from scripts/tmp-scan-colon-lettered-duties-r2.js
// (already validated in round 2) and are NOT modified here. Their only
// job in this round is to identify which candidate lists are genuine
// (so NOT-A-LIST and DEFINITION-LIST are excluded before the drop
// measurement below).
//
// Same 212-bill sample as every prior round, same sampling code.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(__dirname, "../tmp-measure-colon-list-item-drops-results.txt");

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

// ─── Round 2 boundary detection + classification, copied verbatim, unmodified ───

const FORCE_RE = /\b(shall|must|may|will)\b/i;
const DEFINITION_LEADIN_RE = /\bmeans?\s*(the\s+following)?$/i;
const FACTOR_KEYWORDS_RE = /\b(consider(ing)?|factors?|criteria|weigh(ing)?|in\s+determining)\b/i;

const SUBJECT_RE = /^(The|A|An|This|That|These|Those|Any|Each|Every|No|Such|Both|Neither|Either|All|Some|Many|Most|He|She|It|They|We|You|I)\b/;
const FINITE_AUX_RE = /\b(shall|must|may|will|can|could|would|should|is|are|was|were|has|have|had)\b/;
const RELATIVE_PRONOUN_RE = /\b(which|who|whom|that)\b/i;

function isIndependentClause(text) {
  const t = (text || "").trim();
  if (!SUBJECT_RE.test(t)) return false;
  return FINITE_AUX_RE.test(t);
}

function possibleEmbeddedClauseFalsePositive(text) {
  const t = (text || "").trim();
  const auxMatch = t.match(FINITE_AUX_RE);
  if (!auxMatch) return false;
  return RELATIVE_PRONOUN_RE.test(t.slice(0, auxMatch.index));
}

function tightMarkerAt(text, idx) {
  const window = text.slice(idx, idx + 24);
  const m = window.match(/^(\s*(?:and\s+|or\s+)?)\(([a-z]{1,3}|[ivxlcdm]{1,5}|\d{1,3})\)/i);
  if (!m) return null;
  return { prefix: m[1], marker: m[2] };
}

function nextTerminator(text, fromIdx) {
  const semi = text.indexOf(";", fromIdx);
  const per = text.indexOf(".", fromIdx);
  if (semi === -1 && per === -1) return null;
  if (semi === -1) return { idx: per, char: "." };
  if (per === -1) return { idx: semi, char: ";" };
  return semi < per ? { idx: semi, char: ";" } : { idx: per, char: "." };
}

function scanItemAt(text, markerGlobalIdx, marker) {
  const markerEnd = markerGlobalIdx + marker.prefix.length + `(${marker.marker})`.length;
  const term = nextTerminator(text, markerEnd);
  if (!term) return null;
  return { text: text.slice(markerEnd, term.idx).trim(), term };
}

function hasNestedList(itemText) {
  const colonIdx = itemText.indexOf(":");
  if (colonIdx === -1) return false;
  return Boolean(tightMarkerAt(itemText, colonIdx + 1));
}

function findCandidateLists(text) {
  const results = [];
  const colonPositions = [...text.matchAll(/:/g)].map((m) => m.index);

  for (const colonIdx of colonPositions) {
    const first = tightMarkerAt(text, colonIdx + 1);
    if (!first) continue;
    const scan1 = scanItemAt(text, colonIdx + 1, first);
    if (!scan1) continue;

    const before = text.slice(0, colonIdx);
    const leadStartMatches = [...before.matchAll(/[.!?]\s+(?=[A-Z"(])/g)];
    const leadStartMatch = leadStartMatches[leadStartMatches.length - 1];
    const leadStart = leadStartMatch ? leadStartMatch.index + leadStartMatch[0].length : 0;
    const leadIn = text.slice(leadStart, colonIdx).trim();
    const leadInPlusFirstIsOneSentence = !isIndependentClause(scan1.text);

    // record the connector immediately before the FIRST marker too, for
    // completeness, though the trailing-connective signal below only
    // cares about the connector before the LAST item.
    if (!leadInPlusFirstIsOneSentence) {
      results.push({
        leadIn, isNotAList: true,
        boundaryReason: scan1.term.char === "." ? "COMPLETE-SENTENCE-PERIOD" : "SENTENCE-JOINING-SEMICOLON",
        leadInPlusFirstIsOneSentence,
        embeddedClauseFlag: possibleEmbeddedClauseFalsePositive(scan1.text),
        items: [{ marker: first.marker, text: scan1.text, hasOwnForce: FORCE_RE.test(scan1.text), nested: hasNestedList(scan1.text), connectorBefore: first.prefix.trim().toLowerCase() || "none" }],
        fullText: `${leadIn}: (${first.marker}) ${scan1.text}${scan1.term.char}`,
      });
      continue;
    }

    const items = [{ marker: first.marker, text: scan1.text, hasOwnForce: FORCE_RE.test(scan1.text), nested: hasNestedList(scan1.text), connectorBefore: first.prefix.trim().toLowerCase() || "none" }];
    let cursor = scan1.term.idx + 1;
    let boundaryReason = "END-OF-LIST-PUNCTUATION";
    let embeddedClauseFlag = false;

    if (scan1.term.char === ";") {
      while (true) {
        const next = tightMarkerAt(text, cursor);
        if (!next) { boundaryReason = "END-OF-LIST-PUNCTUATION"; break; }
        const scanN = scanItemAt(text, cursor, next);
        if (!scanN) { boundaryReason = "END-OF-LIST-PUNCTUATION"; break; }

        if (isIndependentClause(scanN.text)) {
          boundaryReason = scanN.term.char === ";" ? "SENTENCE-JOINING-SEMICOLON" : "NEW-LEAD-IN";
          if (possibleEmbeddedClauseFalsePositive(scanN.text)) embeddedClauseFlag = true;
          break;
        }
        items.push({ marker: next.marker, text: scanN.text, hasOwnForce: FORCE_RE.test(scanN.text), nested: hasNestedList(scanN.text), connectorBefore: next.prefix.trim().toLowerCase() || "none" });
        if (scanN.term.char === ".") { boundaryReason = "END-OF-LIST-PUNCTUATION"; break; }
        cursor = scanN.term.idx + 1;
      }
    }

    if (items.length < 2) continue;
    results.push({
      leadIn, isNotAList: false, boundaryReason, leadInPlusFirstIsOneSentence, embeddedClauseFlag,
      fullText: `${leadIn}: ${items.map((it) => `(${it.marker}) ${it.text}`).join("; ")}.`,
      items,
    });
  }
  return results;
}

function classify(record) {
  if (record.isNotAList) return "NOT-A-LIST";
  const { leadIn, items } = record;
  if (DEFINITION_LEADIN_RE.test(leadIn)) return "DEFINITION-LIST";
  const withForce = items.filter((it) => it.hasOwnForce);
  if (withForce.length === 0) {
    if (FACTOR_KEYWORDS_RE.test(leadIn)) return "FACTOR-LIST";
    return FORCE_RE.test(leadIn) ? "SHARED-DUTY" : "OTHER";
  }
  if (withForce.length === items.length && items.length >= 2) return "EACH-ITEM-OWN-FORCE";
  return "MIXED";
}

// ─── New for this round: item-presence measurement against the live pipeline ───

const STOPWORDS = new Set([
  "shall", "must", "may", "will", "that", "this", "these", "those", "which",
  "there", "their", "other", "under", "section", "chapter", "subsection",
  "state", "shall", "person", "persons", "before", "after", "where", "when",
  "while", "about", "would", "could", "should", "being", "having",
]);

// A short, distinctive vocabulary for an item: content words (5+ letters)
// that do not also appear in the lead-in or in any other item of the same
// list. Falls back to the item's own longest words (even if shared) only
// when no distinctive word exists at all, flagged as weakSignal so that
// case is visible rather than silently treated the same as a real signal.
function distinctiveWords(itemText, leadIn, otherItemsText) {
  const words = (itemText.toLowerCase().match(/[a-z']{5,}/g) || []);
  const otherWords = new Set(
    `${leadIn} ${otherItemsText}`.toLowerCase().match(/[a-z']{5,}/g) || []
  );
  const distinctive = [...new Set(words)].filter((w) => !otherWords.has(w) && !STOPWORDS.has(w));
  if (distinctive.length) return { words: distinctive, weakSignal: false };
  const fallback = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2);
  return { words: fallback, weakSignal: true };
}

// Every unit carries a `lineage` field -- an internal audit trail logging
// every sentence the pipeline considered during processing, including ones
// filtered out before becoming a unit (e.g. a colon-list item with no
// force-word of its own is still logged in lineage.section.records as part
// of tracking why it was dropped). A blind JSON.stringify(unit) search would
// find a dropped item's text there and wrongly call it PRESENT -- lineage is
// forensic bookkeeping, not pipeline output a reader ever sees. Excluded
// here on purpose; the search below covers every other field (sectionType,
// tetherAnchor, parse, risk, missingSignals, controlFlags, driftDetected,
// status) -- the actual assembled output for the unit.
function unitsContainWord(units, word) {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return units.some((u) => {
    const { lineage, ...rest } = u;
    return re.test(JSON.stringify(rest));
  });
}

const ANY_ALL_RE = /\b(any of the following|all of the following|one or more of the following)\b/i;

function quantifierIn(leadIn) {
  const m = leadIn.match(ANY_ALL_RE);
  return m ? m[1].toLowerCase() : "none";
}

// ─── Main scan ──────────────────────────────────────────────────────────────

const seen = new Map();
let billsFetchedOk = 0;
let totalRawMatches = 0;
const sectionTextByBillSection = new Map();

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
    sectionTextByBillSection.set(`${billNumber}/${section.id}`, section.text);
    const matches = findCandidateLists(text);
    for (const m of matches) {
      totalRawMatches++;
      const cls = classify(m);
      const key = m.fullText;
      if (seen.has(key)) {
        seen.get(key).occurrences.push({ bill: billNumber, section: section.id });
      } else {
        seen.set(key, { ...m, classification: cls, occurrences: [{ bill: billNumber, section: section.id }] });
      }
    }
  }
}

log(`Bills fetched OK: ${billsFetchedOk} / ${batch.length}`);
log(`Total raw candidate-list matches (with duplicates across bills): ${totalRawMatches}`);
const allCandidates = [...seen.values()];
log(`Distinct candidate lists after dedup: ${allCandidates.length}`);

const genuine = allCandidates.filter((r) => r.classification !== "NOT-A-LIST" && r.classification !== "DEFINITION-LIST");
log(`Genuine lists (excluding NOT-A-LIST and DEFINITION-LIST): ${genuine.length}\n`);

// Run each genuine list's section through the live, unmodified pipeline.
let totalItems = 0;
let presentItems = 0;
let droppedItems = 0;
const byClassStats = {};
const listsWithDrops = [];
const listsAllPresent = [];
let quantifierAgree = 0;
let quantifierDisagree = 0;
let quantifierAbsent = 0;
const quantifierCrossTab = {};

for (const record of genuine) {
  const { bill, section } = record.occurrences[0];
  const rawSectionText = sectionTextByBillSection.get(`${bill}/${section}`);
  let pipelineResult;
  try {
    pipelineResult = runPipeline(rawSectionText);
  } catch (err) {
    log(`Bill ${bill}/${section}: pipeline error -- ${err.message}, skipping this list's measurement.\n`);
    continue;
  }
  const units = pipelineResult.units || [];

  const itemResults = record.items.map((item, i) => {
    const otherItemsText = record.items.filter((_, j) => j !== i).map((it) => it.text).join(" ");
    const { words, weakSignal } = distinctiveWords(item.text, record.leadIn, otherItemsText);
    const present = words.some((w) => unitsContainWord(units, w));
    return { marker: item.marker, text: item.text, hasOwnForce: item.hasOwnForce, present, weakSignal, checkedWords: words };
  });

  const dropped = itemResults.filter((r) => !r.present);
  totalItems += itemResults.length;
  presentItems += itemResults.length - dropped.length;
  droppedItems += dropped.length;

  if (!byClassStats[record.classification]) byClassStats[record.classification] = { items: 0, dropped: 0, lists: 0, listsWithAnyDrop: 0 };
  byClassStats[record.classification].items += itemResults.length;
  byClassStats[record.classification].dropped += dropped.length;
  byClassStats[record.classification].lists += 1;
  if (dropped.length) byClassStats[record.classification].listsWithAnyDrop += 1;

  const itemsWithOwnForce = record.items.filter((it) => it.hasOwnForce).length;
  const sharedItems = record.items.length - itemsWithOwnForce;
  const expectedUnitsForThisList = itemsWithOwnForce + (sharedItems > 0 ? 1 : 0);

  const lastItem = record.items[record.items.length - 1];
  const secondToLastConnector = lastItem.connectorBefore;
  const quantifier = quantifierIn(record.leadIn);
  const ctKey = `${quantifier} / trailing=${secondToLastConnector}`;
  quantifierCrossTab[ctKey] = (quantifierCrossTab[ctKey] || 0) + 1;
  if (quantifier === "none") {
    quantifierAbsent++;
  } else {
    const impliesOr = quantifier.includes("any") || quantifier.includes("one or more");
    const impliesAnd = quantifier === "all of the following";
    const agrees = (impliesOr && secondToLastConnector === "or") || (impliesAnd && secondToLastConnector === "and");
    const disagreesMeaningfully = secondToLastConnector !== "none" && !agrees;
    if (agrees) quantifierAgree++;
    else if (disagreesMeaningfully) quantifierDisagree++;
  }

  const enriched = {
    ...record, units, itemResults, expectedUnitsForThisList,
    actualUnitCount: units.length, quantifier, secondToLastConnector,
  };

  if (dropped.length) listsWithDrops.push(enriched);
  else listsAllPresent.push(enriched);
}

log(`─── Measured drop rate (replaces the disputed 80% figure) ───`);
log(`Total genuine lists tested against the live pipeline: ${genuine.length}`);
log(`Total items across those lists: ${totalItems}`);
log(`PRESENT: ${presentItems} (${((presentItems / totalItems) * 100).toFixed(1)}%)`);
log(`DROPPED: ${droppedItems} (${((droppedItems / totalItems) * 100).toFixed(1)}%)\n`);

log(`─── Drop rate by classification ───`);
for (const [cls, stats] of Object.entries(byClassStats).sort((a, b) => b[1].items - a[1].items)) {
  const rate = stats.items ? ((stats.dropped / stats.items) * 100).toFixed(1) : "0.0";
  log(`${cls}: ${stats.dropped}/${stats.items} items dropped (${rate}%), ${stats.listsWithAnyDrop}/${stats.lists} lists had at least one drop`);
}
log("");

log(`─── ANY/ALL quantifier vs. trailing connective agreement ───`);
log(`Agree: ${quantifierAgree}`);
log(`Disagree: ${quantifierDisagree}`);
log(`No quantifier phrase present in lead-in: ${quantifierAbsent}`);
log(`Full cross-tab:`);
for (const [k, v] of Object.entries(quantifierCrossTab).sort((a, b) => b[1] - a[1])) {
  log(`  ${k}: ${v}`);
}
log("");

const nestedGenuine = genuine.filter((r) => r.items.some((it) => it.nested));
log(`Genuine lists with a nested colon sub-list in at least one item: ${nestedGenuine.length}\n`);

function printFullRecord(r, i) {
  log(`[${i}] Occurrences: ${r.occurrences.map((o) => `bill ${o.bill}/${o.section}`).join("; ")}`);
  log(`  CLASSIFICATION: ${r.classification}`);
  log(`  LEAD-IN: ${r.leadIn}`);
  log(`  QUANTIFIER: ${r.quantifier} / TRAILING CONNECTIVE ON LAST ITEM: ${r.secondToLastConnector}`);
  log(`  FULL LIST TEXT: ${r.fullText}`);
  log(`  EXPECTED UNIT COUNT FOR THIS LIST (items with own force-word + 1 for shared-lead-in items if any): ${r.expectedUnitsForThisList}`);
  log(`  ACTUAL UNIT COUNT FOR THE WHOLE SECTION: ${r.actualUnitCount}`);
  log(`  PER-ITEM RESULT:`);
  r.itemResults.forEach((it) => {
    log(`    ITEM ${it.marker} [${it.present ? "PRESENT" : "DROPPED"}]${it.weakSignal ? " (weak signal -- no distinctive vocabulary found, used fallback words)" : ""}: checked words=[${it.checkedWords.join(", ")}]`);
    log(`      TEXT: ${it.text}`);
  });
  log(`  PIPELINE UNITS PRODUCED FOR THIS SECTION (lineage field omitted -- audit trail, not real output; excluded from the presence search above for the same reason):`);
  r.units.forEach((u, idx) => {
    const { lineage, ...rest } = u;
    log(`    UNIT ${idx}: actor=${JSON.stringify(u.parse?.who?.responsibleParty)} modal=${JSON.stringify(u.parse?.who?.modal)}`);
    log(`      ACTION: ${JSON.stringify(u.parse?.what?.action || u.parse?.action || null)}`);
    log(`      CLAIM: ${JSON.stringify(u.parse?.what?.claim || null)}`);
    log(`      RAW UNIT JSON (minus lineage): ${JSON.stringify(rest)}`);
  });
  log("");
}

log(`─── Every list with at least one DROPPED item, in full (${listsWithDrops.length} lists) ───\n`);
listsWithDrops.forEach((r, i) => printFullRecord(r, i + 1));
if (!listsWithDrops.length) log("(none found)\n");

log(`─── Representative sample of lists where every item was PRESENT (up to 15) ───\n`);
listsAllPresent.slice(0, 15).forEach((r, i) => printFullRecord(r, i + 1));
if (!listsAllPresent.length) log("(none found)\n");

writeFileSync(OUTPUT_FILE, out.join("\n"));
console.log(out.join("\n"));
