import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const CORPUS_PATH = path.join(DATA_DIR, "bill-corpus.json");
if (!existsSync(CORPUS_PATH)) {
  console.log("No bill-corpus.json available — cannot run a real corpus-wide comparison.");
  process.exit(1);
}
const CORPUS = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

const ENGLISH_VERBS = new Set(JSON.parse(
  readFileSync(path.join(__dirname, "../lib/english-verbs.json"), "utf8")
));

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// ─── OLD: exactly what's in pipeline.js today, unmodified. ───────────────────
const OLD_MARKER_RE = /\b(which|that|who)\b/gi;
const OLD_NEXT_MARKER_RE = /\b(which|that|who)\b/i;
const CLAUSE_MODAL_RE = /\b(may|shall|must)\b/i;

const PROHIBITION_RE =
  /\bmay not\b|\bmust not\b|\bshall not\b|\bcannot\b|\bis prohibited\b|\bare prohibited\b|\bprohibited from\b/i;
const OBLIGATION_RE =
  /\bshall\b|\bmust\b|\brequired to\b|\bis required\b|\bare required\b|\bobligated to\b|\bis responsible for\b|\bare responsible for\b|\bmust be rounded\b|\bmust be adjusted\b|\bshall be rounded\b|\bshall be adjusted\b|\bis repealed\b|\bare each repealed\b|\bis(?:\s+hereby)?\s+appropriated\b/i;
const PERMISSION_RE =
  /(?<!\bmay not\b.{0,20})\bmay\b(?!\s+not\b)|\bpermitted to\b|\bauthorized to\b|\bis allowed\b/i;

function detectSignal(text) {
  if (PROHIBITION_RE.test(text)) return "prohibition";
  if (OBLIGATION_RE.test(text)) return "obligation";
  if (PERMISSION_RE.test(text)) return "permission";
  return null;
}

function oldDetectRelativeClauses(text) {
  const clauses = [];
  OLD_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = OLD_MARKER_RE.exec(text)) !== null) {
    const marker = m[0].toLowerCase();
    const afterMarker = text.slice(m.index + m[0].length);
    const nextMarkerMatch = OLD_NEXT_MARKER_RE.exec(afterMarker);
    const searchWindow = nextMarkerMatch ? afterMarker.slice(0, nextMarkerMatch.index) : afterMarker;
    const ownModalMatch = CLAUSE_MODAL_RE.exec(searchWindow);
    if (!ownModalMatch) continue;
    const afterOwnModal = searchWindow.slice(ownModalMatch.index + ownModalMatch[0].length);
    const nextModalMatch = CLAUSE_MODAL_RE.exec(afterOwnModal);
    const clauseEndOffset = nextModalMatch
      ? ownModalMatch.index + ownModalMatch[0].length + nextModalMatch.index
      : searchWindow.length;
    const span = [m.index, m.index + m[0].length + clauseEndOffset];
    const clauseText = text.slice(span[0], span[1]).trim();
    clauses.push({ marker, clauseText, span, signal: detectSignal(clauseText) });
    OLD_MARKER_RE.lastIndex = span[1];
  }
  return clauses;
}

function oldDetectSignals(text) {
  const relativeClauses = oldDetectRelativeClauses(text);
  let mainText = text;
  for (const clause of [...relativeClauses].sort((a, b) => b.span[0] - a.span[0])) {
    mainText = mainText.slice(0, clause.span[0]) + mainText.slice(clause.span[1]);
  }
  return {
    primary: detectSignal(mainText),
    additional: relativeClauses.map(({ marker, clauseText, signal }) => ({ marker, clauseText, signal })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW — three genuinely separate pieces, not one function with rules bolted on:
//   1. isVerbLike(word)          — pure word classifier, knows nothing about
//                                  clauses, markers, or demonstratives.
//   2. isDemonstrativeThat(text) — pure gate, knows nothing about the clause
//                                  span-finder. Computes its own boundary.
//                                  Takes only the raw text after "that".
//   3. findClauseSpan(...)       — the shared span-finder which/who always
//                                  used, completely unaware that a
//                                  demonstrative check exists upstream.
// detectRelativeClauses (the orchestrator) is the only piece that knows about
// all three, and it does nothing but wire them together.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Piece 1: word-level verb recognition, with lemmatization ───────────────
// english-verbs.json only lists base forms (and inconsistently at that) — it
// has "provide" but not "provides", "include" but not "includes", "plan" but
// not "plans", and no copula forms ("is"/"are"/"was") at all. Rather than
// trusting exact string membership, strip the common inflections a real verb
// can appear in and check each candidate stem, plus a small fixed map for the
// irregular copula/auxiliary forms no suffix rule can derive.
const IRREGULAR_VERB_FORMS = new Map([
  ["is", "be"], ["are", "be"], ["was", "be"], ["were", "be"], ["been", "be"], ["being", "be"], ["am", "be"],
  ["has", "have"], ["have", "have"], ["had", "have"],
  ["does", "do"], ["did", "do"], ["done", "do"],
]);

function inflectionCandidates(word) {
  const candidates = [word];
  if (word.endsWith("ies") && word.length > 4) candidates.push(word.slice(0, -3) + "y");
  if (word.endsWith("es") && word.length > 3) candidates.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 2) candidates.push(word.slice(0, -1));
  if (word.endsWith("ing") && word.length > 4) {
    const stem = word.slice(0, -3);
    candidates.push(stem, stem + "e");
    if (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2]) candidates.push(stem.slice(0, -1));
  }
  if (word.endsWith("ed") && word.length > 3) {
    const stem = word.slice(0, -2);
    candidates.push(stem, stem + "e");
    if (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2]) candidates.push(stem.slice(0, -1));
  }
  return candidates;
}

function isVerbLike(rawWord) {
  const w = rawWord.toLowerCase();
  if (!w) return false;
  if (CLAUSE_MODAL_RE.test(w)) return true;
  if (IRREGULAR_VERB_FORMS.has(w)) return true;
  for (const candidate of inflectionCandidates(w)) {
    if (ENGLISH_VERBS.has(candidate)) return true;
  }
  return false;
}

// ─── Piece 2: demonstrative-"that" gate, fully self-contained ───────────────
// A demonstrative ("at that hearing", "under that chapter") is a bare noun
// phrase — it never has a verb of its own before the phrase genuinely ends.
// Fix 1: the boundary is real clause-ending punctuation, not any comma —
// a comma inside a coordinated list ("the guests, lodgers, boarders, or
// persons") doesn't end anything. Only colon/semicolon end it; a period only
// ends it when it's an actual sentence-ending period, not a digit/letter
// separator inside an RCW citation like "36.70A.040".
// Fix 2: an empty gap before that boundary (nothing at all between "that"
// and the punctuation, e.g. "that:") is not a demonstrative — a demonstrative
// requires an actual noun. Empty means "not enough evidence to call it
// demonstrative", so it falls through unchanged, same as everything else
// this gate isn't sure about.
const CLAUSE_END_PUNCT_RE = /[:;]|\.(?=\s|$)/;

function isDemonstrativeThat(afterMarker) {
  const punctMatch = CLAUSE_END_PUNCT_RE.exec(afterMarker);
  const scanRegion = punctMatch ? afterMarker.slice(0, punctMatch.index) : afterMarker;
  const words = scanRegion
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z']/g, ""))
    .filter(Boolean);
  if (words.length === 0) return false; // empty gap — not enough evidence, not demonstrative
  return !words.some(isVerbLike);
}

// ─── Piece 3: the shared clause-span finder — unchanged from pipeline.js,
// unaware that a demonstrative gate exists upstream. Used identically for
// which/who and for any "that" that passes the gate. ────────────────────────
function findClauseSpan(text, markerIndex, markerLength, afterMarker) {
  const nextMarkerMatch = OLD_NEXT_MARKER_RE.exec(afterMarker);
  const searchWindow = nextMarkerMatch ? afterMarker.slice(0, nextMarkerMatch.index) : afterMarker;

  const ownModalMatch = CLAUSE_MODAL_RE.exec(searchWindow);
  if (!ownModalMatch) return null;

  const afterOwnModal = searchWindow.slice(ownModalMatch.index + ownModalMatch[0].length);
  const nextModalMatch = CLAUSE_MODAL_RE.exec(afterOwnModal);
  const clauseEndOffset = nextModalMatch
    ? ownModalMatch.index + ownModalMatch[0].length + nextModalMatch.index
    : searchWindow.length;

  const span = [markerIndex, markerIndex + markerLength + clauseEndOffset];
  const clauseText = text.slice(span[0], span[1]).trim();
  return { clauseText, span, signal: detectSignal(clauseText) };
}

// ─── Orchestrator: wires the three pieces together, decides nothing itself ──
function newDetectRelativeClauses(text) {
  const clauses = [];
  OLD_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = OLD_MARKER_RE.exec(text)) !== null) {
    const marker = m[0].toLowerCase();
    const afterMarker = text.slice(m.index + m[0].length);

    if (marker === "that" && isDemonstrativeThat(afterMarker)) {
      OLD_MARKER_RE.lastIndex = m.index + m[0].length;
      continue;
    }

    const found = findClauseSpan(text, m.index, m[0].length, afterMarker);
    if (!found) {
      OLD_MARKER_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    clauses.push({ marker, clauseText: found.clauseText, span: found.span, signal: found.signal });
    OLD_MARKER_RE.lastIndex = found.span[1];
  }
  return clauses;
}

function newDetectSignals(text) {
  const relativeClauses = newDetectRelativeClauses(text);
  let mainText = text;
  for (const clause of [...relativeClauses].sort((a, b) => b.span[0] - a.span[0])) {
    mainText = mainText.slice(0, clause.span[0]) + mainText.slice(clause.span[1]);
  }
  return {
    primary: detectSignal(mainText),
    additional: relativeClauses.map(({ marker, clauseText, signal }) => ({ marker, clauseText, signal })),
  };
}

// ─── Corpus-wide comparison, which/that/who candidates only (same scope as
// the demonstrative-only pass — including/excluding still out of scope). ────
const MARKER_PRESENCE_RE = /\b(which|that|who)\b/i;

let totalSentences = 0;
let candidateSentences = 0;
let sameCount = 0;
let diffCount = 0;
const diffs = [];

function additionalEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.marker === b[i].marker && x.signal === b[i].signal && x.clauseText === b[i].clauseText);
}

for (const bill of CORPUS) {
  const billNumber = String(bill.bill_number);
  for (const sec of bill.sections || []) {
    if (!sec.text?.trim()) continue;
    for (const sentence of splitSentences(sec.text)) {
      totalSentences++;
      if (!MARKER_PRESENCE_RE.test(sentence)) continue;
      candidateSentences++;

      const oldResult = oldDetectSignals(sentence);
      const newResult = newDetectSignals(sentence);

      const same = oldResult.primary === newResult.primary && additionalEqual(oldResult.additional, newResult.additional);
      if (same) {
        sameCount++;
      } else {
        diffCount++;
        diffs.push({ billNumber, sentence, oldResult, newResult });
      }
    }
  }
}

// ─── Re-run the exact 916 sentences still failing after the v1 demonstrative
// fix, plus the full original 5,368 set, to get real before-and-after counts
// against THIS v2 design. ────────────────────────────────────────────────────
function rerunBucket(bucketPath) {
  if (!existsSync(bucketPath)) return null;
  const bucket = JSON.parse(readFileSync(bucketPath, "utf8"));
  let stillDiffers = 0;
  const stillBroken = [];
  for (const d of bucket) {
    const oldResult = oldDetectSignals(d.sentence);
    const newResult = newDetectSignals(d.sentence);
    const same = oldResult.primary === newResult.primary && additionalEqual(oldResult.additional, newResult.additional);
    if (!same) {
      stillDiffers++;
      stillBroken.push({ bill: d.bill, sentence: d.sentence, oldResult, newResult });
    }
  }
  return { total: bucket.length, stillDiffers, fixed: bucket.length - stillDiffers, stillBroken };
}

const rerun5368 = rerunBucket(path.join(__dirname, "_debug-fewer-bucket-input.json"));
const rerun916 = rerunBucket(path.join(__dirname, "_debug-still-916-input.json"));

// ─── Named-case traces — the seven already-proven-correct cases. ────────────
function traceCase(id, sentence) {
  const oldReal = runPipeline(sentence, { billId: id });
  const oldUnit = oldReal.units[0];
  const oldOut = {
    matchedSignals: oldUnit?.tetherAnchor.matchedSignals ?? null,
    subordinateClauseSignals: oldUnit?.tetherAnchor.subordinateClauseSignals ?? null,
  };
  const newOut = newDetectSignals(sentence);
  return { id, sentence, old: oldOut, new: newOut };
}

const NAMED_CASES = [
  {
    id: "bill-1113-full",
    sentence:
      "At that hearing: (i) The rules of evidence do not apply, but the defendant must be afforded the due process rights required for the revocation of probation, including the right to confront and cross-examine all witnesses; (ii) The defendant must have the opportunity to be heard in person and to present evidence; and (iii) If the court finds by a preponderance of the evidence that the defendant is willfully failing to substantially comply with the terms and conditions, the court may either continue the hearing to provide additional time for substantial compliance or end the period of continuance pending dismissal and set a new commencement date.",
  },
  {
    id: "bill-5118",
    sentence:
      "Notwithstanding the provisions of this chapter, the commission may issue a limited license to an applicant selected by the sponsoring institution to be enrolled in one of its designated departmental or divisional fellowship programs provided that the applicant shall have graduated from a recognized medical school and has been granted a license or other appropriate certificate to practice medicine in the location of the applicant's origin.",
  },
  { id: "aggrieved-original", sentence: "Any person who may be aggrieved shall file a written objection within 10 days." },
  {
    id: "bill-2366",
    sentence:
      "The school directors, school superintendents, other school representatives or superintendent candidates may be advanced sufficient sums to cover their anticipated expenses in accordance with rules and regulations promulgated by the state auditor and which shall substantially conform to the procedures provided in RCW 43.03.150 through 43.03.210.",
  },
  {
    id: "bill-5380",
    sentence:
      "The department of ecology or board may require such notice to be accompanied by a fee and determine the amount of such fee: PROVIDED, That the amount of the fee may not exceed the cost of reviewing the plans, specifications, and other information and administering such notice: PROVIDED FURTHER, That any such notice given or notice of construction application submitted to either the board or to the department of ecology shall preclude a further submittal of a duplicate application to any board or to the department of ecology.",
  },
  {
    id: "bill-1251",
    sentence:
      "The commission may establish rules governing mandatory continuing education requirements which shall be met by physicians applying for renewal of licenses, including a requirement that any physician who in the normal course of practice may be required to certify a report of death under chapter 70.58A RCW has received training on entering information into the vital records system operated by the department of health.",
  },
  {
    id: "bill-1158",
    sentence:
      "Respite care may include other services needed by the client, including medical care which must be provided by a licensed health care practitioner.",
  },
];

const namedResults = NAMED_CASES.map((c) => traceCase(c.id, c.sentence));

// ─── Write full report ───────────────────────────────────────────────────────
const outLines = [];
outLines.push(`Total sentences scanned: ${totalSentences}`);
outLines.push(`Candidate sentences (which/that/who only): ${candidateSentences}`);
outLines.push(`Same classification, current real code vs v2 design: ${sameCount}`);
outLines.push(`Different classification: ${diffCount}`);
outLines.push("");
if (rerun5368) {
  outLines.push(`Re-run of the original ${rerun5368.total} false-negative sentences (from the rejected complementizer/comma-gate design) against v2:`);
  outLines.push(`  Still differ from the current real code: ${rerun5368.stillDiffers}`);
  outLines.push(`  Now match the current real code again (fixed): ${rerun5368.fixed}`);
}
outLines.push("");
if (rerun916) {
  outLines.push(`Re-run of the ${rerun916.total} sentences still failing after the v1 demonstrative-only fix, against v2:`);
  outLines.push(`  Still differ from the current real code: ${rerun916.stillDiffers}`);
  outLines.push(`  Now match the current real code again (fixed): ${rerun916.fixed}`);
} else {
  outLines.push("No _debug-still-916-input.json provided — v1-specific re-run skipped.");
}
outLines.push("");
outLines.push("=== NAMED CASE TRACES (the seven already-proven-correct cases) ===");
for (const r of namedResults) {
  outLines.push("-".repeat(80));
  outLines.push(`CASE: ${r.id}`);
  outLines.push(`SENTENCE: ${JSON.stringify(r.sentence)}`);
  outLines.push(`OLD (real runPipeline): ${JSON.stringify(r.old)}`);
  outLines.push(`NEW (v2 design): ${JSON.stringify(r.new)}`);
}
if (rerun916 && rerun916.stillBroken.length) {
  outLines.push("");
  outLines.push(`=== SENTENCES STILL FAILING OUT OF THE ${rerun916.total} (v1 leftovers) ===`);
  for (const d of rerun916.stillBroken) {
    outLines.push("=".repeat(80));
    outLines.push(`BILL: ${d.bill}`);
    outLines.push(`SENTENCE: ${JSON.stringify(d.sentence)}`);
    outLines.push(`OLD: ${JSON.stringify(d.oldResult)}`);
    outLines.push(`NEW: ${JSON.stringify(d.newResult)}`);
  }
}
outLines.push("");
outLines.push("=== ALL CORPUS-WIDE DIFFERENCES (real before/after) ===");
for (const d of diffs) {
  outLines.push("=".repeat(80));
  outLines.push(`BILL: ${d.billNumber}`);
  outLines.push(`SENTENCE: ${JSON.stringify(d.sentence)}`);
  outLines.push(`OLD: ${JSON.stringify(d.oldResult)}`);
  outLines.push(`NEW: ${JSON.stringify(d.newResult)}`);
}

writeFileSync(path.join(__dirname, "_debug-demonstrative-fix-v2-report.txt"), outLines.join("\n"), "utf8");
console.log("Total sentences scanned:", totalSentences);
console.log("Candidate sentences:", candidateSentences);
console.log("Same:", sameCount, "Diff:", diffCount);
if (rerun5368) console.log(`Re-run of ${rerun5368.total} original false negatives: ${rerun5368.fixed} fixed, ${rerun5368.stillDiffers} still differ`);
if (rerun916) console.log(`Re-run of ${rerun916.total} v1 leftovers: ${rerun916.fixed} fixed, ${rerun916.stillDiffers} still differ`);
console.log("Report written to scripts/_debug-demonstrative-fix-v2-report.txt");
