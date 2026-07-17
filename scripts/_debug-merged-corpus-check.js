import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const CORPUS_PATH = path.join(DATA_DIR, "bill-corpus.json");
if (!existsSync(CORPUS_PATH)) {
  console.log("No bill-corpus.json available — cannot run a real corpus-wide check.");
  process.exit(1);
}
const CORPUS = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// ─── Frozen snapshot of the pre-merge algorithm, exactly as it stood in
// pipeline.js before this change — used only as the "before" baseline for
// this one-time comparison. The "after" side below calls the REAL merged
// runPipeline directly, not a reimplementation. ──────────────────────────────
const OLD_MARKER_RE = /\b(which|that|who)\b/gi;
const OLD_NEXT_MARKER_RE = /\b(which|that|who)\b/i;
const OLD_CLAUSE_MODAL_RE = /\b(may|shall|must)\b/i;

const PROHIBITION_RE =
  /\bmay not\b|\bmust not\b|\bshall not\b|\bcannot\b|\bis prohibited\b|\bare prohibited\b|\bprohibited from\b/i;
const OBLIGATION_RE =
  /\bshall\b|\bmust\b|\brequired to\b|\bis required\b|\bare required\b|\bobligated to\b|\bis responsible for\b|\bare responsible for\b|\bmust be rounded\b|\bmust be adjusted\b|\bshall be rounded\b|\bshall be adjusted\b|\bis repealed\b|\bare each repealed\b|\bis(?:\s+hereby)?\s+appropriated\b/i;
const PERMISSION_RE =
  /(?<!\bmay not\b.{0,20})\bmay\b(?!\s+not\b)|\bpermitted to\b|\bauthorized to\b|\bis allowed\b/i;

function oldDetectSignal(text) {
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
    clauses.push({ marker, clauseText, span, signal: oldDetectSignal(clauseText) });
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
    primary: oldDetectSignal(mainText),
    additional: relativeClauses.map(({ marker, clauseText, signal }) => ({ marker, clauseText, signal })),
  };
}

// ─── NEW: the real merged pipeline.js, called through its public API only. ──
function newDetectSignalsViaRealPipeline(sentence) {
  const { units } = runPipeline(sentence, { billId: "corpus-check" });
  const unit = units[0];
  if (!unit) return { primary: null, additional: [] };
  return {
    primary: unit.tetherAnchor.matchedSignals[0] ?? null,
    additional: unit.tetherAnchor.subordinateClauseSignals ?? [],
  };
}

const MARKER_PRESENCE_RE = /\b(which|that|who)\b/i;

function additionalEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.marker === b[i].marker && x.signal === b[i].signal && x.clauseText === b[i].clauseText);
}

let totalSentences = 0;
let candidateSentences = 0;
let sameCount = 0;
let diffCount = 0;
const diffs = [];

for (const bill of CORPUS) {
  const billNumber = String(bill.bill_number);
  for (const sec of bill.sections || []) {
    if (!sec.text?.trim()) continue;
    for (const sentence of splitSentences(sec.text)) {
      totalSentences++;
      if (!MARKER_PRESENCE_RE.test(sentence)) continue;
      candidateSentences++;

      const oldResult = oldDetectSignals(sentence);
      // Compare against the exact same sentence text runPipeline receives —
      // buildUnit's CFS/normalize steps run on the raw sentence, same as the
      // frozen OLD path above, so both sides see identical input text.
      const newResult = newDetectSignalsViaRealPipeline(sentence);

      const same = oldResult.primary === newResult.primary && additionalEqual(oldResult.additional, newResult.additional);
      if (same) sameCount++;
      else {
        diffCount++;
        diffs.push({ billNumber, sentence, oldResult, newResult });
      }
    }
  }
}

const outLines = [];
outLines.push(`Total sentences scanned: ${totalSentences}`);
outLines.push(`Candidate sentences (which/that/who only): ${candidateSentences}`);
outLines.push(`Same classification, frozen pre-merge snapshot vs the real merged pipeline.js: ${sameCount}`);
outLines.push(`Different classification: ${diffCount}`);
outLines.push("");
outLines.push("=== ALL CORPUS-WIDE DIFFERENCES (real before/after, via the real merged runPipeline) ===");
for (const d of diffs) {
  outLines.push("=".repeat(80));
  outLines.push(`BILL: ${d.billNumber}`);
  outLines.push(`SENTENCE: ${JSON.stringify(d.sentence)}`);
  outLines.push(`OLD (frozen pre-merge snapshot): ${JSON.stringify(d.oldResult)}`);
  outLines.push(`NEW (real merged pipeline.js): ${JSON.stringify(d.newResult)}`);
}

writeFileSync(path.join(__dirname, "_debug-merged-corpus-check-report.txt"), outLines.join("\n"), "utf8");
console.log("Total sentences scanned:", totalSentences);
console.log("Candidate sentences:", candidateSentences);
console.log("Same:", sameCount, "Diff:", diffCount);
console.log("Report written to scripts/_debug-merged-corpus-check-report.txt");
