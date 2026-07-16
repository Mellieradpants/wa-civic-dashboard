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

// ─── Tracked separately, per instruction — NOT merged into english-verbs.json
// silently. Confirmed missing base forms found while checking the v2 report's
// remaining 26 differences: "represent", "read", "state" (as a verb, not the
// jurisdiction noun), "suggest", "analyze", "pass". This is a real gap in the
// shared list itself, independent of the demonstrative-check restructuring —
// logged here as its own patch so its contribution can be measured in
// isolation, not folded quietly into the same diff count as the other fixes.
// Should eventually become a real fix to lib/english-verbs.json, filed and
// reviewed on its own.
const VERB_LIST_GAP_PATCH = new Set(["represent", "read", "state", "suggest", "analyze", "pass"]);

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
// NEW v3 — same three-piece separation as v2, with three independent,
// individually-toggleable corrections layered on isDemonstrativeThat:
//
//   Fix D (determiner): a determiner-like word immediately after "that"
//   ("any", "the", "such", ...) blocks the demonstrative call outright, even
//   if no verb is ever found. Narrow and specific — no comma gate, no
//   complementizer classification, nothing else from the earlier rejected
//   design. This alone is what bill 2161 needed: "that any person or
//   entity:" has no verb before its colon, but "any" is never how a genuine
//   demonstrative continues, so it should never even reach the verb check.
//
//   Fix V (verb-list gap patch): a small, explicitly separate supplementary
//   set (VERB_LIST_GAP_PATCH above) for base verbs confirmed missing from
//   english-verbs.json — not merged into the main lookup silently.
//
//   Fix P (abbreviation-period): a period is a real clause boundary only if
//   it's not immediately followed by another word/digit character (excludes
//   RCW-citation numbers like "36.70A.040") AND the token right before it
//   isn't a known abbreviation ("No.", "Sec.", "U.S.C.", etc. — excludes
//   "Federalist No. 40"). These are deliberately two separate checks for two
//   separate problems, not one combined regex.
// ═══════════════════════════════════════════════════════════════════════════

const DETERMINER_RE = /^(a|an|the|any|such|no|each|every|all|some)$/i;

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

function isVerbLike(rawWord, useVerbGapPatch) {
  const w = rawWord.toLowerCase();
  if (!w) return false;
  if (CLAUSE_MODAL_RE.test(w)) return true;
  if (IRREGULAR_VERB_FORMS.has(w)) return true;
  for (const candidate of inflectionCandidates(w)) {
    if (ENGLISH_VERBS.has(candidate)) return true;
    if (useVerbGapPatch && VERB_LIST_GAP_PATCH.has(candidate)) return true;
  }
  return false;
}

// Fix P's abbreviation list — deliberately separate from the RCW-citation
// check below, since they solve two different problems.
const ABBREVIATION_BEFORE_PERIOD_RE =
  /\b(no|nos|sec|secs|ch|chs|vs|etc|e\.g|i\.e|mr|mrs|dr|jr|sr|st|c|ss|sp\.s|u\.s\.c|p\.l|r\.c\.w|cf|vol|para|art|cl|tit|subd|sess)$/i;

function findClauseEndBoundary(text, useAbbreviationFix) {
  const punctRe = /[:;.]/g;
  let m;
  while ((m = punctRe.exec(text)) !== null) {
    const ch = m[0];
    if (ch === ":" || ch === ";") return m.index;
    // ch === "." — first, the RCW-citation check: a period immediately
    // followed by another non-whitespace character (as in "36.70A.040") is
    // never a clause boundary, regardless of the abbreviation fix toggle —
    // this part isn't new, it's what v2 already did.
    const nextChar = text[m.index + 1];
    if (nextChar && !/\s/.test(nextChar)) continue;
    // second, and only when Fix P is enabled: a period preceded by a known
    // abbreviation token ("No.", "Sec.", "U.S.C.") isn't a boundary either —
    // a genuinely different problem from the RCW-citation case, checked here
    // as its own separate condition, not folded into the same regex.
    if (useAbbreviationFix) {
      const before = text.slice(0, m.index);
      const tokenMatch = before.match(/([A-Za-z.]+)$/);
      if (tokenMatch && ABBREVIATION_BEFORE_PERIOD_RE.test(tokenMatch[1])) continue;
    }
    return m.index;
  }
  return -1;
}

function firstWordAfter(afterMarker) {
  const m = /^\s*([A-Za-z']+)/.exec(afterMarker);
  return m ? m[1].toLowerCase() : null;
}

function isDemonstrativeThat(afterMarker, flags) {
  if (flags.determiner) {
    const firstWord = firstWordAfter(afterMarker);
    if (firstWord && DETERMINER_RE.test(firstWord)) return false;
  }
  const boundary = findClauseEndBoundary(afterMarker, flags.abbreviation);
  const scanRegion = boundary === -1 ? afterMarker : afterMarker.slice(0, boundary);
  const words = scanRegion.split(/\s+/).map((w) => w.replace(/[^a-zA-Z']/g, "")).filter(Boolean);
  if (words.length === 0) return false;
  return !words.some((w) => isVerbLike(w, flags.verbGap));
}

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

function makeNewDetectSignals(flags) {
  function newDetectRelativeClauses(text) {
    const clauses = [];
    OLD_MARKER_RE.lastIndex = 0;
    let m;
    while ((m = OLD_MARKER_RE.exec(text)) !== null) {
      const marker = m[0].toLowerCase();
      const afterMarker = text.slice(m.index + m[0].length);

      if (marker === "that" && isDemonstrativeThat(afterMarker, flags)) {
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

  return function newDetectSignals(text) {
    const relativeClauses = newDetectRelativeClauses(text);
    let mainText = text;
    for (const clause of [...relativeClauses].sort((a, b) => b.span[0] - a.span[0])) {
      mainText = mainText.slice(0, clause.span[0]) + mainText.slice(clause.span[1]);
    }
    return {
      primary: detectSignal(mainText),
      additional: relativeClauses.map(({ marker, clauseText, signal }) => ({ marker, clauseText, signal })),
    };
  };
}

// Four configurations to attribute each fix's contribution in isolation,
// not just report one combined number.
const CONFIGS = {
  v2_baseline: { determiner: false, verbGap: false, abbreviation: false },
  plus_determiner: { determiner: true, verbGap: false, abbreviation: false },
  plus_determiner_verbGap: { determiner: true, verbGap: true, abbreviation: false },
  v3_full: { determiner: true, verbGap: true, abbreviation: true },
};
const DETECTORS = Object.fromEntries(
  Object.entries(CONFIGS).map(([name, flags]) => [name, makeNewDetectSignals(flags)])
);

function additionalEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.marker === b[i].marker && x.signal === b[i].signal && x.clauseText === b[i].clauseText);
}
function sameAsOld(oldResult, newResult) {
  return oldResult.primary === newResult.primary && additionalEqual(oldResult.additional, newResult.additional);
}

// ─── Corpus-wide comparison, which/that/who candidates only ────────────────
const MARKER_PRESENCE_RE = /\b(which|that|who)\b/i;

let totalSentences = 0;
let candidateSentences = 0;
const diffCounts = Object.fromEntries(Object.keys(CONFIGS).map((k) => [k, 0]));
const fullDiffs = [];

for (const bill of CORPUS) {
  const billNumber = String(bill.bill_number);
  for (const sec of bill.sections || []) {
    if (!sec.text?.trim()) continue;
    for (const sentence of splitSentences(sec.text)) {
      totalSentences++;
      if (!MARKER_PRESENCE_RE.test(sentence)) continue;
      candidateSentences++;

      const oldResult = oldDetectSignals(sentence);
      const results = {};
      for (const [name, detect] of Object.entries(DETECTORS)) {
        const r = detect(sentence);
        results[name] = r;
        if (!sameAsOld(oldResult, r)) diffCounts[name]++;
      }
      if (!sameAsOld(oldResult, results.v3_full)) {
        fullDiffs.push({ billNumber, sentence, oldResult, results });
      }
    }
  }
}

// ─── Re-run the three known buckets (5368, 916, 26) against v3_full ─────────
function rerunBucket(bucketPath) {
  if (!existsSync(bucketPath)) return null;
  const bucket = JSON.parse(readFileSync(bucketPath, "utf8"));
  let stillDiffers = 0;
  const stillBroken = [];
  for (const d of bucket) {
    const oldResult = oldDetectSignals(d.sentence);
    const newResult = DETECTORS.v3_full(d.sentence);
    if (!sameAsOld(oldResult, newResult)) {
      stillDiffers++;
      stillBroken.push({ bill: d.bill, sentence: d.sentence, oldResult, newResult });
    }
  }
  return { total: bucket.length, stillDiffers, fixed: bucket.length - stillDiffers, stillBroken };
}

const rerun5368 = rerunBucket(path.join(__dirname, "_debug-fewer-bucket-input.json"));
const rerun916 = rerunBucket(path.join(__dirname, "_debug-still-916-input.json"));
const rerun26 = rerunBucket(path.join(__dirname, "_debug-still-26-input.json"));

// ─── Named-case traces ───────────────────────────────────────────────────────
function traceCase(id, sentence) {
  const oldReal = runPipeline(sentence, { billId: id });
  const oldUnit = oldReal.units[0];
  const oldOut = {
    matchedSignals: oldUnit?.tetherAnchor.matchedSignals ?? null,
    subordinateClauseSignals: oldUnit?.tetherAnchor.subordinateClauseSignals ?? null,
  };
  const newOut = DETECTORS.v3_full(sentence);
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
  {
    id: "bill-2161",
    sentence:
      "(2)(a) Whenever the attorney general believes that any person or entity:\n(i) May be in possession, custody, or control of any original or copy of any book, record, report, memorandum, paper, communication, tabulation, map, chart, photograph, mechanical transcription, or other tangible document or recording, wherever situate, which he or she believes to be relevant to the subject matter of an investigation of a possible violation of state or federal law under subsection (1) of this section; or\n(ii) May have knowledge of any information which the attorney general believes relevant to the subject matter of such an investigation,\nhe or she may, prior to the institution of a civil proceeding thereon, execute in writing and cause to be served upon such a person, a civil investigative demand requiring such person or entity to produce such documentary material and permit inspection and copying, to answer in writing written interrogatories, to give oral testimony, or any combination of such demands pertaining to such documentary material or information.",
  },
  {
    id: "bill-2085-abbreviation",
    sentence:
      "(3) The legislature further recognizes that in Federalist No. 40 by James Madison, it is the precious right of the people to \"abolish or alter their governments as to them shall seem most likely to effect their safety and happiness.\"",
  },
];

const namedResults = NAMED_CASES.map((c) => traceCase(c.id, c.sentence));

// ─── Write full report ───────────────────────────────────────────────────────
const outLines = [];
outLines.push(`Total sentences scanned: ${totalSentences}`);
outLines.push(`Candidate sentences (which/that/who only): ${candidateSentences}`);
outLines.push("");
outLines.push("Diff count vs current real code, by configuration (isolating each fix's contribution):");
outLines.push(`  v2 baseline (no new fixes):                          ${diffCounts.v2_baseline}`);
outLines.push(`  + determiner check only:                             ${diffCounts.plus_determiner}`);
outLines.push(`  + determiner check + verb-list-gap patch:            ${diffCounts.plus_determiner_verbGap}`);
outLines.push(`  + determiner + verb-gap + abbreviation-period (v3):  ${diffCounts.v3_full}`);
outLines.push("");
for (const [label, rerun] of [["5368 original false negatives", rerun5368], ["916 still failing after v1", rerun916], ["26 still differing after v2", rerun26]]) {
  if (!rerun) continue;
  outLines.push(`Re-run of the ${rerun.total} ${label}, against v3_full:`);
  outLines.push(`  Still differ from the current real code: ${rerun.stillDiffers}`);
  outLines.push(`  Now match the current real code again (fixed): ${rerun.fixed}`);
  outLines.push("");
}
outLines.push("=== NAMED CASE TRACES (the seven already-proven-correct cases, plus bill 2161 and bill 2085) ===");
for (const r of namedResults) {
  outLines.push("-".repeat(80));
  outLines.push(`CASE: ${r.id}`);
  outLines.push(`SENTENCE: ${JSON.stringify(r.sentence)}`);
  outLines.push(`OLD (real runPipeline): ${JSON.stringify(r.old)}`);
  outLines.push(`NEW (v3_full design): ${JSON.stringify(r.new)}`);
}
if (rerun26 && rerun26.stillBroken.length) {
  outLines.push("");
  outLines.push(`=== SENTENCES STILL DIFFERING OUT OF THE 26 (v2 leftovers), under v3_full ===`);
  for (const d of rerun26.stillBroken) {
    outLines.push("=".repeat(80));
    outLines.push(`BILL: ${d.bill}`);
    outLines.push(`SENTENCE: ${JSON.stringify(d.sentence)}`);
    outLines.push(`OLD: ${JSON.stringify(d.oldResult)}`);
    outLines.push(`NEW: ${JSON.stringify(d.newResult)}`);
  }
}
outLines.push("");
outLines.push("=== ALL CORPUS-WIDE DIFFERENCES UNDER v3_full (real before/after, all four configs shown) ===");
for (const d of fullDiffs) {
  outLines.push("=".repeat(80));
  outLines.push(`BILL: ${d.billNumber}`);
  outLines.push(`SENTENCE: ${JSON.stringify(d.sentence)}`);
  outLines.push(`OLD: ${JSON.stringify(d.oldResult)}`);
  for (const name of Object.keys(CONFIGS)) {
    outLines.push(`${name}: ${JSON.stringify(d.results[name])}`);
  }
}

writeFileSync(path.join(__dirname, "_debug-demonstrative-fix-v3-report.txt"), outLines.join("\n"), "utf8");
console.log("Total sentences scanned:", totalSentences);
console.log("Candidate sentences:", candidateSentences);
console.log("Diff counts:", JSON.stringify(diffCounts));
if (rerun5368) console.log(`5368 bucket: ${rerun5368.fixed} fixed, ${rerun5368.stillDiffers} still differ`);
if (rerun916) console.log(`916 bucket: ${rerun916.fixed} fixed, ${rerun916.stillDiffers} still differ`);
if (rerun26) console.log(`26 bucket: ${rerun26.fixed} fixed, ${rerun26.stillDiffers} still differ`);
console.log("Report written to scripts/_debug-demonstrative-fix-v3-report.txt");
