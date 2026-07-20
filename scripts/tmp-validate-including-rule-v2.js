#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Applies the REVISED (round 2) candidate including/excluding list-boundary
// rule to the same real sentence set from the earlier discovery sweep /
// round 1 validation run, and reports where the rule believes each list
// starts and ends. Raw output only — no scoring, no interpretation, no rule
// changes.

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
// Same pool construction as round 1, so the bill sample is identical.
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

// ─── The revised candidate rule, implemented exactly as specified ──────────

const MARKER_RE = /\b(including|excluding)\b/i;

const FILLER_PHRASES = [
  "but not limited to",
  "but not confined to",
  "without limiting the scope hereof",
  "without limitation",
  "at a minimum",
  "at minimum",
  "among other things",
  "among others",
  "as appropriate",
  "if applicable",
];
const FILLER_RE = new RegExp(
  `^\\s*,?\\s*(${FILLER_PHRASES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")})\\s*,?\\s*`,
  "i"
);

const GATE2_PRECEDING_WORDS = new Set(["of", "by", "from", "for", "requires", "require", "is", "are"]);

const STOP2_PHRASES = [
  "shall not", "does not", "do not",
  "shall", "must", "may not", "may", "will",
  "is", "are", "was", "were", "be", "been",
  "requires", "constitutes", "files",
];
const STOP2_RE = new RegExp(`\\b(${STOP2_PHRASES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")})\\b`, "i");

const STOP3_CONNECTORS = [
  "so long as", "if", "unless", "except", "provided", "whether",
  "on", "to", "in", "for", "of", "upon", "regardless",
];

const REFERENCE_TAG_RE = /^\s*as\s+(defined|described|provided|authorized|required|identified|specified|set forth)\s+in\b/i;
const BUT_CONTINUE_RE = /^\s*but\s+(that|who|which)\b/i;
const BUT_ANY_RE = /^\s*but\b/i;

const BARE_WORD_RE = new RegExp(
  `\\b(${STOP2_PHRASES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")}|if|unless|also\\s+[a-z]+)\\b`,
  "gi"
);

function lastWord(s) {
  const m = s.trim().match(/([A-Za-z']+)$/);
  return m ? m[1].toLowerCase() : null;
}

// Gate 3(b), tightened: NON_SENTENCE only if the marker's own line or an
// immediately adjacent line is a short (<60 char), unpunctuated, unlabeled
// line — a real table-row/label line, not an ordinary lettered sub-item.
function isShortLabelLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length >= 60) return false;
  if (/[.!?;]/.test(trimmed)) return false;
  if (/^\(?[a-zA-Z0-9]{1,3}\)/.test(trimmed)) return false;
  return true;
}

function looksLikeTableBlock(sentence, markerIndex) {
  const lines = sentence.split("\n");
  let charCount = 0;
  let markerLineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= markerIndex) { markerLineIdx = i; break; }
    charCount += lines[i].length + 1;
  }
  for (const idx of [markerLineIdx - 1, markerLineIdx, markerLineIdx + 1]) {
    if (idx < 0 || idx >= lines.length) continue;
    if (isShortLabelLine(lines[idx])) return true;
  }
  return false;
}

function absorbFillers(sentence, startPos) {
  let pos = startPos;
  while (true) {
    const m = FILLER_RE.exec(sentence.slice(pos));
    if (!m) break;
    pos += m[0].length;
  }
  return pos;
}

function findEnclosingParen(sentence, markerStart) {
  const stack = [];
  for (let i = 0; i < markerStart; i++) {
    if (sentence[i] === "(") stack.push(i);
    else if (sentence[i] === ")") stack.pop();
  }
  return stack.length > 0 ? stack[stack.length - 1] : -1;
}

// "May" the month (e.g. "May 1, 2026", "no later than May 15") must not be
// treated as the modal "may" in STOP-2/STOP-4 — only a bare "may" (not
// "may not") immediately followed by a day-number is the date case.
function isMayDateMatch(text, matchIndex, matchText) {
  if (matchText.toLowerCase() !== "may") return false;
  const after = text.slice(matchIndex + matchText.length);
  return /^\s+\d{1,2}(st|nd|rd|th)?\b/i.test(after);
}

function stop2SegmentFires(segment) {
  const re = new RegExp(STOP2_RE.source, "gi");
  let mm;
  while ((mm = re.exec(segment))) {
    if (isMayDateMatch(segment, mm.index, mm[0])) continue;
    return true;
  }
  return false;
}

function findCommaBoundedStop(sentence, scanPos) {
  const candidates = [];

  // STOP-1: every semicolon is a hard-stop candidate.
  for (let idx = sentence.indexOf(";", scanPos); idx !== -1; idx = sentence.indexOf(";", idx + 1)) {
    candidates.push(idx);
  }

  // STOP-4: bare instruction/if/unless/"also X" word with no comma directly before it.
  BARE_WORD_RE.lastIndex = 0;
  let bm;
  while ((bm = BARE_WORD_RE.exec(sentence))) {
    if (bm.index < scanPos) continue;
    if (isMayDateMatch(sentence, bm.index, bm[0])) continue;
    const before = sentence.slice(0, bm.index).replace(/\s+$/, "");
    if (before.endsWith(",")) continue;
    candidates.push(bm.index);
  }

  // STOP-2 / STOP-3: comma-triggered, with "but"/reference-tag exceptions.
  for (let idx = sentence.indexOf(",", scanPos); idx !== -1; idx = sentence.indexOf(",", idx + 1)) {
    const rest = sentence.slice(idx + 1);

    if (BUT_CONTINUE_RE.test(rest)) continue; // ", but that/who/which ..." — describes current item, continue
    if (REFERENCE_TAG_RE.test(rest)) continue; // ", as defined/described/... in ..." — citation tag, continue

    if (BUT_ANY_RE.test(rest)) {
      candidates.push(idx);
      continue;
    }

    const nextCommaIdx = sentence.indexOf(",", idx + 1);
    const nextSemiIdx = sentence.indexOf(";", idx + 1);
    let segmentEnd = sentence.length;
    if (nextCommaIdx !== -1) segmentEnd = Math.min(segmentEnd, nextCommaIdx);
    if (nextSemiIdx !== -1) segmentEnd = Math.min(segmentEnd, nextSemiIdx);
    const segment = sentence.slice(idx + 1, segmentEnd);

    const stop3Fires = STOP3_CONNECTORS.some((w) =>
      new RegExp(`^\\s*${w.replace(/\s+/g, "\\s+")}\\b`, "i").test(rest)
    );
    if (stop3Fires) {
      candidates.push(idx);
      continue;
    }

    if (stop2SegmentFires(segment)) {
      candidates.push(idx);
      continue;
    }
    // otherwise: plain separator comma within the list, keep scanning
  }

  const inRange = candidates.filter((p) => p >= scanPos);
  if (inRange.length === 0) return null;
  return Math.min(...inRange);
}

function classifyAndBound(sentence, billNumber) {
  const m = MARKER_RE.exec(sentence);
  if (!m) return null;
  const markerStart = m.index;
  const markerEnd = m.index + m[0].length;

  // Gate 1 — reversal check
  const before = sentence.slice(0, markerStart).replace(/,\s*$/, "");
  if (lastWord(before) === "not") {
    return { classification: "REVERSED", listText: null, after: null };
  }

  // Gate 2 — verb-use check, revised: skip only if NOT followed by a filler
  const precedingWord = lastWord(before);
  const followedByFiller = FILLER_RE.test(sentence.slice(markerEnd));
  if (precedingWord && GATE2_PRECEDING_WORDS.has(precedingWord) && !followedByFiller) {
    return { classification: "NOT_A_LIST", listText: null, after: null };
  }

  // Gate 3 — non-sentence check, revised
  if ((billNumber >= 4000 && billNumber <= 4999) || (billNumber >= 8000 && billNumber <= 8999)) {
    return { classification: "NON_SENTENCE", listText: null, after: null };
  }
  if (looksLikeTableBlock(sentence, markerStart)) {
    return { classification: "NON_SENTENCE", listText: null, after: null };
  }

  const scanPos = absorbFillers(sentence, markerEnd);

  // Shape (a): PARENTHETICAL — capture fixed to the full parenthetical content
  const openParenIdx = findEnclosingParen(sentence, markerStart);
  if (openParenIdx !== -1) {
    const closeIdx = sentence.indexOf(")", scanPos);
    if (closeIdx !== -1) {
      return {
        classification: "PARENTHETICAL",
        listText: sentence.slice(openParenIdx + 1, closeIdx),
        after: sentence.slice(closeIdx + 1, closeIdx + 1 + 80),
      };
    }
  }

  // Shape (b): COLON_SUBLIST
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
      };
    }
    // inline items, no letter/number labels: runs to the sentence's own period;
    // embedded semicolons are item separators, not stops.
    const endIdx = sentence.replace(/[.;]+\s*$/, "").length;
    return {
      classification: "COLON_SUBLIST",
      listText: sentence.slice(markerStart, endIdx),
      after: sentence.slice(endIdx, endIdx + 80),
    };
  }

  // Shape (c): COMMA_BOUNDED
  const stopPos = findCommaBoundedStop(sentence, scanPos);
  if (stopPos !== null) {
    const endIdx = sentence.slice(0, stopPos).replace(/\s+$/, "").length;
    return {
      classification: "COMMA_BOUNDED",
      listText: sentence.slice(markerStart, endIdx),
      after: sentence.slice(stopPos, stopPos + 80),
    };
  }

  // Shape (d): SENTENCE_END
  const endIdx = sentence.replace(/[.;]+\s*$/, "").length;
  return {
    classification: "SENTENCE_END",
    listText: sentence.slice(markerStart, endIdx),
    after: sentence.slice(endIdx, endIdx + 80),
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
