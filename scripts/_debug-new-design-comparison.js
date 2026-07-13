import { readFileSync, existsSync } from "node:fs";
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

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// ─── OLD detection, exactly as it stands in pipeline.js today ───────────────
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

// ─── NEW design, as proposed in the design doc, not yet built into pipeline.js ─
const NEW_MARKER_RE = /\b(which|that|who|including|excluding)\b/gi;
const NEW_NEXT_MARKER_RE = /\b(which|that|who|including|excluding)\b/i;
const NEW_CLAUSE_MODAL_RE = /\b(may|shall|must)\b/i;
const DETERMINER_RE = /\b(a|an|the|any|such|no|each|every|all|some)\b/i;
const COMMA_RE = /,/;

function classifyThat(afterMarker) {
  const firstWordMatch = /\S+/.exec(afterMarker);
  const firstWord = firstWordMatch ? firstWordMatch[0].replace(/[.,;:]$/, "") : "";
  if (NEW_CLAUSE_MODAL_RE.test(firstWord)) return "relative-subject";
  if (DETERMINER_RE.test(firstWord)) return "complementizer";
  return "demonstrative";
}

function newDetectRelativeClauses(text) {
  const clauses = [];
  NEW_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = NEW_MARKER_RE.exec(text)) !== null) {
    const marker = m[0].toLowerCase();
    const afterMarker = text.slice(m.index + m[0].length);

    if (marker === "that") {
      const kind = classifyThat(afterMarker);
      if (kind === "demonstrative") {
        NEW_MARKER_RE.lastIndex = m.index + m[0].length;
        continue;
      }
      if (kind === "complementizer") {
        const nextMarkerMatch = NEW_NEXT_MARKER_RE.exec(afterMarker);
        const searchWindow = nextMarkerMatch ? afterMarker.slice(0, nextMarkerMatch.index) : afterMarker;
        const firstCommaIdx = searchWindow.search(COMMA_RE);
        const beforeComma = firstCommaIdx === -1 ? searchWindow : searchWindow.slice(0, firstCommaIdx);
        const gateModal = NEW_CLAUSE_MODAL_RE.exec(beforeComma);
        if (!gateModal) {
          NEW_MARKER_RE.lastIndex = m.index + m[0].length;
          continue; // comma before any modal — not a candidate
        }
        // gate passed (modal before first comma, or no comma at all) — fall through
        // to the same own-modal / clause-end search as every other marker, using
        // the FULL search window, not the comma-truncated one.
      }
      // "relative-subject" falls through to the same handling as which/who.
    }

    const nextMarkerMatch = NEW_NEXT_MARKER_RE.exec(afterMarker);
    const searchWindow = nextMarkerMatch ? afterMarker.slice(0, nextMarkerMatch.index) : afterMarker;

    const ownModalMatch = NEW_CLAUSE_MODAL_RE.exec(searchWindow);
    if (!ownModalMatch) {
      NEW_MARKER_RE.lastIndex = m.index + m[0].length;
      continue;
    }

    const afterOwnModal = searchWindow.slice(ownModalMatch.index + ownModalMatch[0].length);
    const nextModalMatch = NEW_CLAUSE_MODAL_RE.exec(afterOwnModal);
    const clauseEndOffset = nextModalMatch
      ? ownModalMatch.index + ownModalMatch[0].length + nextModalMatch.index
      : searchWindow.length;

    const span = [m.index, m.index + m[0].length + clauseEndOffset];
    const clauseText = text.slice(span[0], span[1]).trim();
    clauses.push({ marker, clauseText, span, signal: detectSignal(clauseText) });
    NEW_MARKER_RE.lastIndex = span[1];
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

// ─── Gather every real sentence from the corpus that contains any of the
// five marker words — the union of the two sets already scanned today ───────
const MARKER_PRESENCE_RE = /\b(which|that|who|including|excluding)\b/i;

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

const outLines = [];
outLines.push(`Total sentences scanned: ${totalSentences}`);
outLines.push(`Candidate sentences (contain which/that/who/including/excluding): ${candidateSentences}`);
outLines.push(`Same classification under old vs new design: ${sameCount}`);
outLines.push(`Different classification under old vs new design: ${diffCount}`);
outLines.push("");
outLines.push("=== ALL DIFFERENCES (real before/after) ===");
for (const d of diffs) {
  outLines.push("=".repeat(80));
  outLines.push(`BILL: ${d.billNumber}`);
  outLines.push(`SENTENCE: ${JSON.stringify(d.sentence)}`);
  outLines.push(`OLD: ${JSON.stringify(d.oldResult)}`);
  outLines.push(`NEW: ${JSON.stringify(d.newResult)}`);
}

console.log("Total sentences scanned:", totalSentences);
console.log("Candidate sentences (contain which/that/who/including/excluding):", candidateSentences);
console.log("Same classification under old vs new design:", sameCount);
console.log("Different classification under old vs new design:", diffCount);

// ─── Bill 5118 explicit trace, run through both the real old runPipeline and
// the new-design local reimplementation, for direct side-by-side comparison ──
const BILL_5118_SENTENCE =
  "Notwithstanding the provisions of this chapter, the commission may issue a limited license to an applicant selected by the sponsoring institution to be enrolled in one of its designated departmental or divisional fellowship programs provided that the applicant shall have graduated from a recognized medical school and has been granted a license or other appropriate certificate to practice medicine in the location of the applicant's origin.";

console.log();
console.log("=== BILL 5118 EXPLICIT TRACE ===");
console.log("SENTENCE:", JSON.stringify(BILL_5118_SENTENCE));

const oldPipelineResult = runPipeline(BILL_5118_SENTENCE, { billId: "bill-5118-trace" });
const oldUnit = oldPipelineResult.units[0];
console.log("OLD (real runPipeline):", JSON.stringify({
  matchedSignals: oldUnit?.tetherAnchor.matchedSignals ?? null,
  subordinateClauseSignals: oldUnit?.tetherAnchor.subordinateClauseSignals ?? null,
}));

const newResult5118 = newDetectSignals(BILL_5118_SENTENCE);
console.log("NEW (design reimplementation):", JSON.stringify(newResult5118));

let realCorpusSentence5118 = null;
for (const bill of CORPUS) {
  if (String(bill.bill_number) !== "5118") continue;
  for (const sec of bill.sections || []) {
    if (!sec.text?.trim()) continue;
    for (const sentence of splitSentences(sec.text)) {
      if (/provided that the applicant/i.test(sentence)) {
        realCorpusSentence5118 = sentence;
      }
    }
  }
}
console.log();
console.log("REAL CORPUS SENTENCE FOR BILL 5118 (exact, for verification):");
console.log(JSON.stringify(realCorpusSentence5118));
if (realCorpusSentence5118) {
  const oldReal = runPipeline(realCorpusSentence5118, { billId: "bill-5118-trace-real" });
  const oldRealUnit = oldReal.units[0];
  console.log("OLD on real corpus sentence:", JSON.stringify({
    matchedSignals: oldRealUnit?.tetherAnchor.matchedSignals ?? null,
    subordinateClauseSignals: oldRealUnit?.tetherAnchor.subordinateClauseSignals ?? null,
  }));
  const newReal = newDetectSignals(realCorpusSentence5118);
  console.log("NEW on real corpus sentence:", JSON.stringify(newReal));
}

// ─── Write full results to a file in the repo checkout so the complete
// diff list survives regardless of job-log size limits — committed by the
// workflow, read directly, then deleted along with the rest of this temp setup.
import { writeFileSync } from "node:fs";
const reportLines = [
  `Total sentences scanned: ${totalSentences}`,
  `Candidate sentences (contain which/that/who/including/excluding): ${candidateSentences}`,
  `Same classification under old vs new design: ${sameCount}`,
  `Different classification under old vs new design: ${diffCount}`,
  "",
  "=== BILL 5118 EXPLICIT TRACE ===",
  `SENTENCE: ${JSON.stringify(BILL_5118_SENTENCE)}`,
  `OLD (real runPipeline): ${JSON.stringify({ matchedSignals: oldUnit?.tetherAnchor.matchedSignals ?? null, subordinateClauseSignals: oldUnit?.tetherAnchor.subordinateClauseSignals ?? null })}`,
  `NEW (design reimplementation): ${JSON.stringify(newResult5118)}`,
  `REAL CORPUS SENTENCE FOR BILL 5118: ${JSON.stringify(realCorpusSentence5118)}`,
  "",
  ...outLines,
];
writeFileSync(path.join(__dirname, "_debug-comparison-report.txt"), reportLines.join("\n"), "utf8");
console.log();
console.log("Report written to scripts/_debug-comparison-report.txt");
