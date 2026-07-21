#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Applies the round-3 candidate including/excluding list-boundary rule
// (round 2 logic + 4 named revisions: table-gate repair, relative-clause
// shield on STOP-4, colon look-ahead, "May [date]" guard formalized) to the
// same real sentence set as rounds 1-2. Raw output only — no scoring, no
// interpretation, no rule changes beyond the four revisions.

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
// Same pool construction as rounds 1-2, so the bill sample is identical.
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

// ─── The round-3 candidate rule ─────────────────────────────────────────────

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

// Revision 2: a relative pronoun between the most recent comma (or list
// start) and a bare STOP-4 word means the verb describes the current list
// item, not a fresh instruction.
const RELATIVE_PRONOUN_RE = /\b(who|whom|whose|that|which)\b/i;

function lastWord(s) {
  const m = s.trim().match(/([A-Za-z']+)$/);
  return m ? m[1].toLowerCase() : null;
}

// Revision 1: a line ending in normal sentence structure (colon, semicolon,
// "; and"/"; or"/", and"/", or") is never a table label line, and the table
// gate only fires on 3+ consecutive label-like lines.
function isShortLabelLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length >= 60) return false;
  if (/^\(?[a-zA-Z0-9]{1,3}\)/.test(trimmed)) return false;
  if (/[.!?]/.test(trimmed)) return false;
  if (/[:;]\s*$/.test(trimmed)) return false;
  if (/[,;]\s*(and|or)\s*$/i.test(trimmed)) return false;
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
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i <= lines.length; i++) {
    const isLabel = i < lines.length && isShortLabelLine(lines[i]);
    if (isLabel) {
      if (runLen === 0) runStart = i;
      runLen++;
    } else {
      if (runLen >= 3) {
        const runEnd = i - 1;
        if (runEnd >= markerLineIdx - 1 && runStart <= markerLineIdx + 1) return true;
      }
      runLen = 0;
    }
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

// Revision 4 (formalized): "May" the month (e.g. "May 1, 2026") must not be
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

// Revision 3: the colon-sublist shape triggers on a colon within the first
// N words after the marker (after filler), not only immediately after.
function findLookaheadColon(sentence, scanPos, maxWords) {
  const text = sentence.slice(scanPos);
  const re = /\S+/g;
  let m;
  let wordsSeen = 0;
  while ((m = re.exec(text)) && wordsSeen < maxWords) {
    const token = m[0];
    const colonIdxInToken = token.indexOf(":");
    if (colonIdxInToken !== -1) return scanPos + m.index + colonIdxInToken;
    if (/[.;]/.test(token)) return -1;
    wordsSeen++;
  }
  return -1;
}

function findCommaBoundedStop(sentence, scanPos) {
  const candidates = [];

  // STOP-1: every semicolon is a hard-stop candidate.
  for (let idx = sentence.indexOf(";", scanPos); idx !== -1; idx = sentence.indexOf(";", idx + 1)) {
    candidates.push(idx);
  }

  // STOP-4: bare instruction/if/unless/"also X" word with no comma directly
  // before it, and (revision 2) not describing the current item via a
  // relative pronoun since the most recent comma.
  BARE_WORD_RE.lastIndex = 0;
  let bm;
  while ((bm = BARE_WORD_RE.exec(sentence))) {
    if (bm.index < scanPos) continue;
    if (isMayDateMatch(sentence, bm.index, bm[0])) continue;
    const before = sentence.slice(0, bm.index).replace(/\s+$/, "");
    if (before.endsWith(",")) continue;
    const lastCommaBefore = sentence.lastIndexOf(",", bm.index);
    const spanStart = lastCommaBefore >= scanPos ? lastCommaBefore + 1 : scanPos;
    const backSpan = sentence.slice(spanStart, bm.index);
    if (RELATIVE_PRONOUN_RE.test(backSpan)) continue;
    candidates.push(bm.index);
  }

  // STOP-2 / STOP-3: comma-triggered, with "but"/reference-tag exceptions.
  for (let idx = sentence.indexOf(",", scanPos); idx !== -1; idx = sentence.indexOf(",", idx + 1)) {
    const rest = sentence.slice(idx + 1);

    if (BUT_CONTINUE_RE.test(rest)) continue;
    if (REFERENCE_TAG_RE.test(rest)) continue;

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

  // Gate 2 — verb-use check
  const precedingWord = lastWord(before);
  const followedByFiller = FILLER_RE.test(sentence.slice(markerEnd));
  if (precedingWord && GATE2_PRECEDING_WORDS.has(precedingWord) && !followedByFiller) {
    return { classification: "NOT_A_LIST", listText: null, after: null };
  }

  // Gate 3 — non-sentence check (revision 1 in looksLikeTableBlock)
  if ((billNumber >= 4000 && billNumber <= 4999) || (billNumber >= 8000 && billNumber <= 8999)) {
    return { classification: "NON_SENTENCE", listText: null, after: null };
  }
  if (looksLikeTableBlock(sentence, markerStart)) {
    return { classification: "NON_SENTENCE", listText: null, after: null };
  }

  const scanPos = absorbFillers(sentence, markerEnd);

  // Shape (a): PARENTHETICAL
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

  // Shape (b): COLON_SUBLIST — revision 3: colon may be within the first 6
  // words after the marker/filler, not only immediately after.
  const colonIdx = findLookaheadColon(sentence, scanPos, 6);
  if (colonIdx !== -1) {
    const afterColon = sentence.slice(colonIdx + 1);
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
      const endIdx = colonIdx + 1 + consumedText.length;
      return {
        classification: "COLON_SUBLIST",
        listText: sentence.slice(markerStart, endIdx),
        after: sentence.slice(endIdx, endIdx + 80),
      };
    }
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

const seen = new Map();
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

const ROUND1_COUNTS = {
  SENTENCE_END: 441, COMMA_BOUNDED: 118, COLON_SUBLIST: 22,
  NON_SENTENCE: 13, NOT_A_LIST: 7, REVERSED: 7, PARENTHETICAL: 7,
};
const ROUND2_COUNTS = {
  COMMA_BOUNDED: 318, SENTENCE_END: 224, COLON_SUBLIST: 30,
  NON_SENTENCE: 23, NOT_A_LIST: 6, REVERSED: 7, PARENTHETICAL: 7,
};

console.log("\nSummary counts per classification (round 3 | round 2 | round 1):");
const allClasses = new Set([...Object.keys(counts), ...Object.keys(ROUND1_COUNTS), ...Object.keys(ROUND2_COUNTS)]);
for (const cls of allClasses) {
  console.log(`  ${cls}: ${counts[cls] || 0} | ${ROUND2_COUNTS[cls] || 0} | ${ROUND1_COUNTS[cls] || 0}`);
}
console.log(`\nDone. ${batch.length} bills sampled, ${billsFetchedOk} bills fetched successfully, ${candidateCount} candidate sentences found (with duplicates), ${seen.size} distinct sentences classified.`);
