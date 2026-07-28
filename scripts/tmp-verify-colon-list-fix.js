#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Corpus-wide verification for the colon-lettered-list-item-drop fix on this
// branch. Reuses round 2's boundary-detection and classification logic
// verbatim (unmodified) to find genuine colon-lettered lists across the same
// 212-bill sample used throughout this project, then runs each list's
// section text through the FIXED runPipeline (this branch) and checks
// whether every item's distinctive content survives into some unit's real
// output.
//
// Fixes the known bug in the earlier drop-measurement script
// (tmp-measure-colon-list-item-drops.js, still on main): that script scoped
// an item's "distinctive vocabulary" only against its own list's lead-in and
// sibling items, so a word shared with a DIFFERENT, similarly-worded list
// elsewhere in the same section (a real pattern in WA sentencing/aggravator
// statutes, which deliberately parallel their own factor lists) could
// produce a false PRESENT verdict. This script scopes distinctiveness
// against the WHOLE REST OF THE SECTION text instead — if a word appears
// anywhere else in the section, in any other sentence or list, it is not
// treated as distinctive for this item.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(__dirname, "../tmp-verify-colon-list-fix-results.txt");

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
log(`Sampling every ${step} bills\n`);

function singleLine(s) {
  return s.replace(/\s+/g, " ").trim();
}

// ─── Round 2 boundary detection + classification, copied verbatim, unmodified ───

const FORCE_RE = /\b(shall|must|may|will)\b/i;
const DEFINITION_LEADIN_RE = /\bmeans?\s*(the\s+following)?$/i;
const FACTOR_KEYWORDS_RE = /\b(consider(ing)?|factors?|criteria|weigh(ing)?|in\s+determining)\b/i;

const SUBJECT_RE = /^(The|A|An|This|That|These|Those|Any|Each|Every|No|Such|Both|Neither|Either|All|Some|Many|Most|He|She|It|They|We|You|I)\b/;
const FINITE_AUX_RE = /\b(shall|must|may|will|can|could|would|should|is|are|was|were|has|have|had)\b/;

function isIndependentClause(text) {
  const t = (text || "").trim();
  if (!SUBJECT_RE.test(t)) return false;
  return FINITE_AUX_RE.test(t);
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

    if (!leadInPlusFirstIsOneSentence) {
      results.push({
        leadIn, isNotAList: true,
        items: [{ marker: first.marker, text: scan1.text, hasOwnForce: FORCE_RE.test(scan1.text), nested: hasNestedList(scan1.text) }],
        fullText: `${leadIn}: (${first.marker}) ${scan1.text}${scan1.term.char}`,
      });
      continue;
    }

    const items = [{ marker: first.marker, text: scan1.text, hasOwnForce: FORCE_RE.test(scan1.text), nested: hasNestedList(scan1.text) }];
    let cursor = scan1.term.idx + 1;

    if (scan1.term.char === ";") {
      while (true) {
        const next = tightMarkerAt(text, cursor);
        if (!next) break;
        const scanN = scanItemAt(text, cursor, next);
        if (!scanN) break;

        if (isIndependentClause(scanN.text)) break;
        items.push({ marker: next.marker, text: scanN.text, hasOwnForce: FORCE_RE.test(scanN.text), nested: hasNestedList(scanN.text) });
        if (scanN.term.char === ".") break;
        cursor = scanN.term.idx + 1;
      }
    }

    if (items.length < 2) continue;
    results.push({
      leadIn, isNotAList: false,
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

// ─── Item-presence measurement, scoped correctly this time ─────────────────

const STOPWORDS = new Set([
  "shall", "must", "may", "will", "that", "this", "these", "those", "which",
  "there", "their", "other", "under", "section", "chapter", "subsection",
  "state", "person", "persons", "before", "after", "where", "when",
  "while", "about", "would", "could", "should", "being", "having",
]);

// Distinctiveness is scoped against the WHOLE REST OF THE SECTION text, not
// just this item's own list -- this is the fix for the known bug in the
// earlier measurement script, which only compared within one list and could
// be fooled by a similarly-worded DIFFERENT list elsewhere in the same
// section.
function distinctiveWords(itemText, restOfSectionText) {
  const words = itemText.toLowerCase().match(/[a-z']{5,}/g) || [];
  const restWords = new Set(restOfSectionText.toLowerCase().match(/[a-z']{5,}/g) || []);
  const distinctive = [...new Set(words)].filter((w) => !restWords.has(w) && !STOPWORDS.has(w));
  if (distinctive.length) return { words: distinctive, weakSignal: false };
  const fallback = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2);
  return { words: fallback, weakSignal: true };
}

function unitsContainWord(units, word) {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return units.some((u) => {
    const { lineage, ...rest } = u;
    return re.test(JSON.stringify(rest));
  });
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

let totalItems = 0;
let presentItems = 0;
let droppedItems = 0;
const byClassStats = {};
const droppedRecords = [];

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
  const fullSectionSingleLine = singleLine(rawSectionText);

  const itemResults = record.items.map((item) => {
    const restOfSection = fullSectionSingleLine.split(item.text).join(" ");
    const { words, weakSignal } = distinctiveWords(item.text, restOfSection);
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

  if (dropped.length) {
    droppedRecords.push({ ...record, units, itemResults, actualUnitCount: units.length });
  }
}

log(`─── Measured drop rate after the fix ───`);
log(`Total genuine lists tested against the FIXED pipeline: ${genuine.length}`);
log(`Total items across those lists: ${totalItems}`);
log(`PRESENT: ${presentItems} (${totalItems ? ((presentItems / totalItems) * 100).toFixed(1) : "0.0"}%)`);
log(`DROPPED: ${droppedItems} (${totalItems ? ((droppedItems / totalItems) * 100).toFixed(1) : "0.0"}%)\n`);

log(`─── Drop rate by classification ───`);
for (const [cls, stats] of Object.entries(byClassStats).sort((a, b) => b[1].items - a[1].items)) {
  const rate = stats.items ? ((stats.dropped / stats.items) * 100).toFixed(1) : "0.0";
  log(`${cls}: ${stats.dropped}/${stats.items} items dropped (${rate}%), ${stats.listsWithAnyDrop}/${stats.lists} lists had at least one drop`);
}
log("");

function printRecord(r, i) {
  log(`[${i}] Occurrences: ${r.occurrences.map((o) => `bill ${o.bill}/${o.section}`).join("; ")}`);
  log(`  CLASSIFICATION: ${r.classification}`);
  log(`  LEAD-IN: ${r.leadIn}`);
  log(`  FULL LIST TEXT: ${r.fullText}`);
  log(`  ACTUAL UNIT COUNT FOR THE WHOLE SECTION: ${r.actualUnitCount}`);
  log(`  PER-ITEM RESULT:`);
  r.itemResults.forEach((it) => {
    log(`    ITEM ${it.marker} [${it.present ? "PRESENT" : "DROPPED"}]${it.weakSignal ? " (weak signal)" : ""}: checked words=[${it.checkedWords.join(", ")}]`);
    log(`      TEXT: ${it.text}`);
  });
  log(`  PIPELINE UNITS (lineage omitted):`);
  r.units.forEach((u, idx) => {
    const { lineage, ...rest } = u;
    log(`    UNIT ${idx}: actor=${JSON.stringify(u.parse?.who?.responsibleParty)} modal=${JSON.stringify(u.parse?.who?.modal)}`);
    log(`      ACTION: ${JSON.stringify(u.parse?.what?.action || null)}`);
    log(`      RAW: ${JSON.stringify(rest)}`);
  });
  log("");
}

log(`─── Every list with at least one DROPPED item after the fix, in full (${droppedRecords.length} lists) ───\n`);
droppedRecords.forEach((r, i) => printRecord(r, i + 1));
if (!droppedRecords.length) log("(none found -- zero drops across the whole sample)\n");

writeFileSync(OUTPUT_FILE, out.join("\n"));
console.log(out.join("\n"));
