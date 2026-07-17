import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.join(__dirname, "../data/wa/bill-corpus.json");
if (!existsSync(CORPUS_PATH)) {
  console.log("No bill-corpus.json available.");
  process.exit(1);
}
const CORPUS = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

// Frozen pre-merge snapshot, identical to what was used for the full corpus check.
const OLD_MARKER_RE = /\b(which|that|who)\b/gi;
const OLD_NEXT_MARKER_RE = /\b(which|that|who)\b/i;
const OLD_CLAUSE_MODAL_RE = /\b(may|shall|must)\b/i;
const PROHIBITION_RE = /\bmay not\b|\bmust not\b|\bshall not\b|\bcannot\b|\bis prohibited\b|\bare prohibited\b|\bprohibited from\b/i;
const OBLIGATION_RE = /\bshall\b|\bmust\b|\brequired to\b|\bis required\b|\bare required\b|\bobligated to\b|\bis responsible for\b|\bare responsible for\b|\bmust be rounded\b|\bmust be adjusted\b|\bshall be rounded\b|\bshall be adjusted\b|\bis repealed\b|\bare each repealed\b|\bis(?:\s+hereby)?\s+appropriated\b/i;
const PERMISSION_RE = /(?<!\bmay not\b.{0,20})\bmay\b(?!\s+not\b)|\bpermitted to\b|\bauthorized to\b|\bis allowed\b/i;
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
    const clauseEndOffset = nextModalMatch ? ownModalMatch.index + ownModalMatch[0].length + nextModalMatch.index : searchWindow.length;
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

const MANUALLY_REPRODUCED_SENTENCE =
  "The board:\n(a) May establish escalating penalties for violation of this chapter, provided that the cumulative effect of any such escalating penalties cannot last beyond two years and the escalation applies only to multiple violations that are the same or similar in nature;\n(b) May not include cancellation of a license for a single violation, unless the board can prove by a preponderance of the evidence:\n(i) Diversion of cannabis product to the illicit market or sales across state lines;\n(ii) Furnishing of cannabis product to minors;\n(iii) Diversion of revenue to criminal enterprises, gangs, cartels, or parties not qualified to hold a cannabis license based on criminal history requirements;\n(iv) The commission of noncannabis-related crimes; or\n(v) Knowingly making a misrepresentation of fact to the board, an officer of the board, or an employee of the board related to conduct or an action that is, or alleged to be, any of the violations identified in (b)(i) through (iv) of this subsection (2);\n(c) May include cancellation of a license for cumulative violations only if a cannabis licensee commits at least four violations within a two-year period of time;\n(d) Must consider aggravating and mitigating circumstances and deviate from the prescribed penalties accordingly, and must authorize enforcement officers to do the same, provided that such penalty may not exceed the maximum escalating penalty prescribed by the board for that violation; and\n(e) Must give substantial consideration to mitigating any penalty imposed on a licensee when there is employee misconduct that led to the\n\nviolation and the licensee:\n(i) Established a compliance program designed to prevent the violation;\n(ii) Performed meaningful training with employees designed to prevent the violation; and\n(iii) Had not enabled or ignored the violation or other similar violations in the past.";

const outLines = [];
const bill1884 = CORPUS.find((b) => String(b.bill_number) === "1884");
outLines.push(`Bill 1884 found in corpus: ${!!bill1884}`);
if (bill1884) {
  outLines.push(`Number of sections: ${bill1884.sections?.length ?? 0}`);
  outLines.push("");

  for (let secIdx = 0; secIdx < (bill1884.sections || []).length; secIdx++) {
    const sec = bill1884.sections[secIdx];
    if (!sec.text?.trim()) continue;
    if (!/violation/i.test(sec.text)) continue; // narrow to the relevant section(s) only

    outLines.push("=".repeat(80));
    outLines.push(`SECTION INDEX: ${secIdx}`);
    outLines.push(`RAW SECTION TEXT (first 400 chars): ${JSON.stringify(sec.text.slice(0, 400))}`);
    outLines.push(`RAW SECTION TEXT LENGTH: ${sec.text.length}`);
    outLines.push("");

    const result = runPipeline(sec.text, { billId: "1884" });
    outLines.push(`Number of preprocessed candidate sentences in this section: ${result.lineage.sentences.length}`);
    outLines.push("");

    for (const record of result.lineage.sentences) {
      if (!/violation/i.test(record.text)) continue;
      outLines.push("-".repeat(80));
      outLines.push(`REAL PREPROCESSED SENTENCE (id ${record.id}, matched=${record.matched}, rule=${record.rule}):`);
      outLines.push(JSON.stringify(record.text));
      outLines.push("");
      outLines.push(`MATCHES the manually-reproduced sentence used earlier? ${record.text === MANUALLY_REPRODUCED_SENTENCE}`);

      // Show a direct character-level diff summary if they differ
      if (record.text !== MANUALLY_REPRODUCED_SENTENCE) {
        const a = record.text, b = MANUALLY_REPRODUCED_SENTENCE;
        let firstDiff = 0;
        while (firstDiff < a.length && firstDiff < b.length && a[firstDiff] === b[firstDiff]) firstDiff++;
        outLines.push(`First differing character at index: ${firstDiff}`);
        outLines.push(`REAL text around divergence:     ...${JSON.stringify(a.slice(Math.max(0, firstDiff - 60), firstDiff + 60))}...`);
        outLines.push(`MANUAL text around divergence:    ...${JSON.stringify(b.slice(Math.max(0, firstDiff - 60), firstDiff + 60))}...`);
        outLines.push(`REAL length: ${a.length}, MANUAL length: ${b.length}`);
      }
      outLines.push("");

      // Check for a CFS block on this exact real sentence
      const cfsBlocked = result.lineage.section.records.some(
        (r) => r.producedBy === "L3 CFS" && r.matched && r.parentNodeId === record.id
      );
      outLines.push(`CFS-blocked: ${cfsBlocked}`);

      // OLD (frozen snapshot) applied to the REAL preprocessed sentence
      const oldResult = oldDetectSignals(record.text);
      outLines.push(`OLD (frozen snapshot) on the REAL preprocessed sentence: ${JSON.stringify(oldResult)}`);

      // NEW (real merged pipeline) result for this same real sentence, read from the unit
      const unit = result.units.find((u) => u.lineage?.sentence?.id === record.id);
      const newResult = unit
        ? { primary: unit.tetherAnchor.matchedSignals[0] ?? null, additional: unit.tetherAnchor.subordinateClauseSignals ?? [] }
        : { primary: null, additional: [], note: "no unit produced" };
      outLines.push(`NEW (real merged pipeline.js) on the REAL preprocessed sentence: ${JSON.stringify(newResult)}`);
      outLines.push("");

      // Also run OLD and NEW on the MANUALLY REPRODUCED sentence, for direct side-by-side
      const oldResultManual = oldDetectSignals(MANUALLY_REPRODUCED_SENTENCE);
      const manualPipelineResult = runPipeline(MANUALLY_REPRODUCED_SENTENCE, { billId: "1884-manual" });
      const manualUnit = manualPipelineResult.units[0];
      const newResultManual = manualUnit
        ? { primary: manualUnit.tetherAnchor.matchedSignals[0] ?? null, additional: manualUnit.tetherAnchor.subordinateClauseSignals ?? [] }
        : { primary: null, additional: [], note: "no unit produced" };
      outLines.push(`OLD (frozen snapshot) on the MANUALLY-REPRODUCED sentence: ${JSON.stringify(oldResultManual)}`);
      outLines.push(`NEW (real merged pipeline.js) on the MANUALLY-REPRODUCED sentence: ${JSON.stringify(newResultManual)}`);
    }
  }
}

writeFileSync(path.join(__dirname, "_debug-trace-1884-report.txt"), outLines.join("\n"), "utf8");
console.log(outLines.join("\n"));
console.log("\nReport written to scripts/_debug-trace-1884-report.txt");
