#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Applies a CANDIDATE (not yet implemented anywhere) including/excluding
// list-boundary rule to the same real sentence set from the earlier wide
// discovery sweep, and reports where the rule believes each list starts and
// ends. Raw output only — no scoring, no interpretation, no rule changes.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
// Same pool construction as the wide discovery sweep, so the bill sample is
// identical: sentinels + confirmed no-document SGA bills excluded, plus the
// whole 4000-4999 range (House Joint Memorials/Resolutions/Concurrent
// Resolutions — WHEREAS-style declaratory text, not substantive obligation
// text, confirmed by an earlier scan that landed there).
const excludedNumbers = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);
const pool = [...new Set(
  BILL_INDEX.map(b => Number(b.bill_number))
    .filter(n => !excludedNumbers.has(n))
    .filter(n => !(n >= 4000 && n <= 4999))
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

// ─── The candidate rule, implemented exactly as specified ───────────────────

const MARKER_RE = /\b(including|excluding)\b/i;

const FILLER_RE = /^\s*,?\s*(but not limited to|without limitation|at minimum|among others)\s*,?\s*/i;

const RESUMPTION_WORDS = ["but", "if", "as", "on", "for", "unless", "except", "provided", "so long as", "whether"];
const MODAL_RE = /\b(may not|shall|must|may|cannot)\b/i;

const GATE2_PRECEDING_WORDS = new Set(["of", "by", "from", "for", "requires", "require", "is", "are"]);

function lastWord(s) {
  const m = s.trim().match(/([A-Za-z']+)$/);
  return m ? m[1].toLowerCase() : null;
}

function firstWord(s) {
  const m = s.trim().match(/^([A-Za-z']+)/);
  return m ? m[1].toLowerCase() : null;
}

// Gate 3's "table-like block" check, applied within the candidate sentence's
// own text (sentence splitting already preserves internal newlines) — three
// or more consecutive lines near the marker with no sentence-ending
// punctuation at all.
function looksLikeTableBlock(sentence, markerIndex) {
  const lines = sentence.split("\n");
  let charCount = 0;
  let markerLineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= markerIndex) { markerLineIdx = i; break; }
    charCount += lines[i].length + 1;
  }
  const windowStart = Math.max(0, markerLineIdx - 1);
  const windowEnd = Math.min(lines.length, markerLineIdx + 2);
  let consecutive = 0;
  let maxConsecutive = 0;
  for (let i = windowStart; i < windowEnd; i++) {
    if (!/[.!?]/.test(lines[i])) {
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  return maxConsecutive >= 3;
}

function classifyAndBound(sentence, billNumber) {
  const m = MARKER_RE.exec(sentence);
  if (!m) return null;
  const markerStart = m.index;
  const markerEnd = m.index + m[0].length;

  // Gate 1 — reversal check
  const before = sentence.slice(0, markerStart).replace(/,\s*$/, "");
  if (lastWord(before) === "not") {
    return { classification: "REVERSED", listText: null, after: null, markerStart, markerEnd };
  }

  // Gate 2 — verb-use check
  const precedingWord = lastWord(before);
  if (precedingWord && GATE2_PRECEDING_WORDS.has(precedingWord)) {
    return { classification: "NOT_A_LIST", listText: null, after: null, markerStart, markerEnd };
  }

  // Gate 3 — non-sentence check
  if ((billNumber >= 4000 && billNumber <= 4999) || (billNumber >= 8000 && billNumber <= 8299)) {
    return { classification: "NON_SENTENCE", listText: null, after: null, markerStart, markerEnd };
  }
  if (looksLikeTableBlock(sentence, markerStart)) {
    return { classification: "NON_SENTENCE", listText: null, after: null, markerStart, markerEnd };
  }

  // Start: marker, plus any immediately-following filler phrase (absorbed so
  // the filler's own words — e.g. "but" in "but not limited to" — don't get
  // misread as a resumption signal by shape (c) below).
  let scanPos = markerEnd;
  const fillerMatch = FILLER_RE.exec(sentence.slice(scanPos));
  if (fillerMatch) scanPos += fillerMatch[0].length;

  // Shape (a): PARENTHETICAL — marker sits inside parentheses
  const upToMarker = sentence.slice(0, markerStart);
  const openParens = (upToMarker.match(/\(/g) || []).length;
  const closeParens = (upToMarker.match(/\)/g) || []).length;
  if (openParens > closeParens) {
    const closeIdx = sentence.indexOf(")", scanPos);
    if (closeIdx !== -1) {
      const endIdx = closeIdx + 1;
      return {
        classification: "PARENTHETICAL",
        listText: sentence.slice(markerStart, endIdx),
        after: sentence.slice(endIdx, endIdx + 80),
        markerStart, markerEnd,
      };
    }
  }

  // Shape (b): COLON_SUBLIST — marker (after filler) followed by a colon and
  // lettered/numbered items
  const afterFillerRaw = sentence.slice(scanPos);
  const colonMatch = /^\s*,?\s*:/.exec(afterFillerRaw);
  if (colonMatch) {
    const afterColon = afterFillerRaw.slice(colonMatch[0].length);
    const firstItemMatch = /^\s*\n?\s*\(?[a-zA-Z0-9]{1,3}\)/.exec(afterColon);
    if (firstItemMatch) {
      const linesAfterColon = afterColon.split("\n");
      let consumedLines = 0;
      for (const line of linesAfterColon) {
        if (/^\s*\(?[a-zA-Z0-9]{1,3}\)/.test(line) || line.trim() === "") {
          consumedLines++;
        } else {
          break;
        }
      }
      const consumedText = linesAfterColon.slice(0, consumedLines).join("\n");
      const endIdx = scanPos + colonMatch[0].length + consumedText.length;
      return {
        classification: "COLON_SUBLIST",
        listText: sentence.slice(markerStart, endIdx),
        after: sentence.slice(endIdx, endIdx + 80),
        markerStart, markerEnd,
      };
    }
  }

  // Shape (c): COMMA_BOUNDED — scan forward comma by comma for a resumption signal
  let searchFrom = scanPos;
  while (true) {
    const commaIdx = sentence.indexOf(",", searchFrom);
    if (commaIdx === -1) break;
    const nextSegment = sentence.slice(commaIdx + 1);
    const nextWord = firstWord(nextSegment);
    const nextPhraseIsResumption = RESUMPTION_WORDS.some((w) => {
      if (w.includes(" ")) return nextSegment.trim().toLowerCase().startsWith(w);
      return nextWord === w;
    });
    if (nextPhraseIsResumption) {
      return {
        classification: "COMMA_BOUNDED",
        listText: sentence.slice(markerStart, commaIdx),
        after: sentence.slice(commaIdx, commaIdx + 80),
        markerStart, markerEnd,
      };
    }
    // "fresh actor followed by shall/may/must/may not" — look at the segment
    // up to the next comma (or sentence end) for a modal word preceded by at
    // least one other word within that segment.
    const nextCommaIdx = sentence.indexOf(",", commaIdx + 1);
    const segmentEnd = nextCommaIdx === -1 ? sentence.length : nextCommaIdx;
    const segment = sentence.slice(commaIdx + 1, segmentEnd);
    const modalMatch = MODAL_RE.exec(segment);
    if (modalMatch) {
      const wordsBeforeModal = segment.slice(0, modalMatch.index).trim().split(/\s+/).filter(Boolean);
      if (wordsBeforeModal.length >= 1) {
        return {
          classification: "COMMA_BOUNDED",
          listText: sentence.slice(markerStart, commaIdx),
          after: sentence.slice(commaIdx, commaIdx + 80),
          markerStart, markerEnd,
        };
      }
    }
    searchFrom = commaIdx + 1;
  }

  // Shape (d): SENTENCE_END — no resumption found, list runs to the sentence's own end
  const endIdx = sentence.replace(/[.;]+\s*$/, "").length;
  return {
    classification: "SENTENCE_END",
    listText: sentence.slice(markerStart, endIdx),
    after: sentence.slice(endIdx, endIdx + 80),
    markerStart, markerEnd,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log(`Pool size (excluding sentinels, no-document bills, and 4000-4999 memorials/resolutions): ${pool.length}`);
console.log(`Sampling every ${step} bills, ${batch.length} bills total: ${batch.join(", ")}\n`);

const seen = new Map(); // sentence text -> { result, occurrences: [{bill, section}] }
let candidateCount = 0;
let billsFetchedOk = 0;

for (const billNumber of batch) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), BIENNIUM);
  } catch (err) {
    console.log(`Bill ${billNumber}: SKIP — ${err.message}`);
    continue;
  }
  billsFetchedOk++;
  for (const section of data.sections || []) {
    if (!section.text?.trim()) continue;
    for (const sentence of splitSentences(section.text)) {
      if (!MARKER_RE.test(sentence)) continue;
      candidateCount++;
      if (seen.has(sentence)) {
        seen.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        continue;
      }
      const result = classifyAndBound(sentence, billNumber);
      seen.set(sentence, { result, occurrences: [{ bill: billNumber, section: section.id }] });
    }
  }
}

console.log(`Total candidate sentences (with duplicates): ${candidateCount}`);
console.log(`Distinct sentences after dedup: ${seen.size}\n`);

const counts = {};
let printedIdx = 0;
for (const [sentence, { result, occurrences }] of seen.entries()) {
  counts[result.classification] = (counts[result.classification] || 0) + 1;
  printedIdx++;
  const firstOcc = occurrences[0];
  const dupNote = occurrences.length > 1
    ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  console.log(`--- RESULT ${printedIdx} — bill ${firstOcc.bill}, section ${firstOcc.section}, classification=${result.classification}${dupNote} ---`);
  console.log(`sentence: ${sentence}`);
  if (result.listText !== null) {
    console.log(`list text: ${result.listText}`);
    console.log(`after list end (80 chars): ${result.after}`);
  }
  console.log();
}

console.log("\nSummary counts per classification:");
for (const [cls, count] of Object.entries(counts)) {
  console.log(`  ${cls}: ${count}`);
}
console.log(`\nDone. ${batch.length} bills sampled, ${billsFetchedOk} bills fetched successfully, ${candidateCount} candidate sentences found (with duplicates), ${seen.size} distinct sentences classified.`);
