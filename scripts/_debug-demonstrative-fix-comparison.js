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

// ─── OLD detection, exactly as it stands in pipeline.js today (no change) ───
const OLD_MARKER_RE = /\b(which|that|who)\b/gi;
const OLD_NEXT_MARKER_RE = /\b(which|that|who)\b/i;
const OLD_CLAUSE_MODAL_RE = /\b(may|shall|must)\b/i;

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
    const ownModalMatch = OLD_CLAUSE_MODAL_RE.exec(searchWindow);
    if (!ownModalMatch) continue;
    const afterOwnModal = searchWindow.slice(ownModalMatch.index + ownModalMatch[0].length);
    const nextModalMatch = OLD_CLAUSE_MODAL_RE.exec(afterOwnModal);
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

// ─── NEW: demonstrative-"that" recognition only. No determiner list, no
// comma gate, no complementizer classification. which/who unchanged.
// including/excluding not touched — out of scope for this pass. ──────────────
// A demonstrative "that" ("at that hearing", "under that chapter") is just a
// bare noun phrase acting as a modifier — it never has a verb of its own
// before the phrase ends (at the next clause-ending punctuation, or the next
// marker, whichever comes first). If ANY verb-like word (a modal, or a word
// in the same English-verb list parseActorActionCondition already trusts)
// turns up before that boundary, this is not a bare noun phrase — treat it
// exactly like every other "that" always has been, unchanged.
function isDemonstrativeThat(afterMarker, boundedWindow) {
  const punctMatch = /[:;,.]/.exec(boundedWindow);
  const scanRegion = punctMatch ? boundedWindow.slice(0, punctMatch.index) : boundedWindow;
  const words = scanRegion
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z']/g, "").toLowerCase())
    .filter(Boolean);
  const hasVerb = words.some((w) => OLD_CLAUSE_MODAL_RE.test(w) || ENGLISH_VERBS.has(w));
  return !hasVerb;
}

function newDetectRelativeClauses(text) {
  const clauses = [];
  OLD_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = OLD_MARKER_RE.exec(text)) !== null) {
    const marker = m[0].toLowerCase();
    const afterMarker = text.slice(m.index + m[0].length);
    const nextMarkerMatch = OLD_NEXT_MARKER_RE.exec(afterMarker);
    const searchWindow = nextMarkerMatch ? afterMarker.slice(0, nextMarkerMatch.index) : afterMarker;

    if (marker === "that" && isDemonstrativeThat(afterMarker, searchWindow)) {
      OLD_MARKER_RE.lastIndex = m.index + m[0].length;
      continue; // cleanly ignored — not a clause of any kind
    }

    const ownModalMatch = OLD_CLAUSE_MODAL_RE.exec(searchWindow);
    if (!ownModalMatch) {
      OLD_MARKER_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    const afterOwnModal = searchWindow.slice(ownModalMatch.index + ownModalMatch[0].length);
    const nextModalMatch = OLD_CLAUSE_MODAL_RE.exec(afterOwnModal);
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
// the original 691-sentence scan — including/excluding intentionally excluded,
// since that mechanism is not part of this fix). ─────────────────────────────
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

// ─── Re-run the exact 5,368 previously-confirmed false-negative sentences
// (from the earlier, rejected complementizer/comma-gate design) against THIS
// revised design, to prove those specific known failures are now fixed —
// i.e. this design's output matches the CURRENT real code again for those. ──
let reraCheckedCount = 0;
let rerunStillDiffersFromOld = 0;
const stillBroken = [];
const FEWER_BUCKET_PATH = path.join(__dirname, "_debug-fewer-bucket-input.json");
if (existsSync(FEWER_BUCKET_PATH)) {
  const fewerBucket = JSON.parse(readFileSync(FEWER_BUCKET_PATH, "utf8"));
  for (const d of fewerBucket) {
    reraCheckedCount++;
    const oldResult = oldDetectSignals(d.sentence);
    const newResult = newDetectSignals(d.sentence);
    const same = oldResult.primary === newResult.primary && additionalEqual(oldResult.additional, newResult.additional);
    if (!same) {
      rerunStillDiffersFromOld++;
      stillBroken.push({ bill: d.bill, sentence: d.sentence, oldResult, newResult });
    }
  }
}

// ─── Explicit named-case checks ──────────────────────────────────────────────
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

const BILL_1113_SENTENCE =
  "At that hearing: (i) The rules of evidence do not apply, but the defendant must be afforded the due process rights required for the revocation of probation, including the right to confront and cross-examine all witnesses; (ii) The defendant must have the opportunity to be heard in person and to present evidence; and (iii) If the court finds by a preponderance of the evidence that the defendant is willfully failing to substantially comply with the terms and conditions, the court may either continue the hearing to provide additional time for substantial compliance or end the period of continuance pending dismissal and set a new commencement date.";

const NAMED_CASES = [
  { id: "bill-1113-full", sentence: BILL_1113_SENTENCE },
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
outLines.push(`Same classification, old real code vs new demonstrative-only design: ${sameCount}`);
outLines.push(`Different classification: ${diffCount}`);
outLines.push("");
outLines.push(`Re-run of the ${reraCheckedCount} previously-confirmed false-negative sentences (from the rejected complementizer/comma-gate design) against this revised design:`);
outLines.push(`  Still differ from the current real code: ${rerunStillDiffersFromOld}`);
outLines.push(`  Now match the current real code again (i.e. false negative fixed): ${reraCheckedCount - rerunStillDiffersFromOld}`);
outLines.push("");
outLines.push("=== NAMED CASE TRACES ===");
for (const r of namedResults) {
  outLines.push("-".repeat(80));
  outLines.push(`CASE: ${r.id}`);
  outLines.push(`SENTENCE: ${JSON.stringify(r.sentence)}`);
  outLines.push(`OLD (real runPipeline): ${JSON.stringify(r.old)}`);
  outLines.push(`NEW (demonstrative-only design): ${JSON.stringify(r.new)}`);
}
outLines.push("");
outLines.push(`=== SENTENCES STILL DIFFERING FROM OLD, OUT OF THE ${reraCheckedCount} PREVIOUSLY-CONFIRMED FALSE NEGATIVES (should be 0 or explainable) ===`);
for (const d of stillBroken) {
  outLines.push("=".repeat(80));
  outLines.push(`BILL: ${d.bill}`);
  outLines.push(`SENTENCE: ${JSON.stringify(d.sentence)}`);
  outLines.push(`OLD: ${JSON.stringify(d.oldResult)}`);
  outLines.push(`NEW: ${JSON.stringify(d.newResult)}`);
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

writeFileSync(path.join(__dirname, "_debug-demonstrative-fix-report.txt"), outLines.join("\n"), "utf8");
console.log("Total sentences scanned:", totalSentences);
console.log("Candidate sentences:", candidateSentences);
console.log("Same:", sameCount, "Diff:", diffCount);
console.log(`Re-run of ${reraCheckedCount} known false negatives: ${rerunStillDiffersFromOld} still differ, ${reraCheckedCount - rerunStillDiffersFromOld} fixed`);
console.log("Report written to scripts/_debug-demonstrative-fix-report.txt");
