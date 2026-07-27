#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Corpus-wide check for the status-attached content-loss fix: for every
// unit in the sampled corpus, render with the current branch code and with
// main's code (checked out into a scratch dir) and compare. Reports how
// many units differ, classifies each difference, and — for every unit
// whose actor was swallowed by a force-less status clause (the only code
// path this fix touches) — checks that no significant word from the
// original source sentence is missing from the branch's rendered output.
// Uses the same 212-bill sampling methodology already established and
// accepted for this rule (see tmp-validate-and-split-rule-r4.js).

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";
import { renderUnit as renderUnitBranch } from "../lib/plain-meaning/renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(REPO_ROOT, "tmp-validation-content-loss-results.txt");

// ─── Check out main's renderer/templates/pipeline into a scratch dir ───────
const mainDir = mkdtempSync(path.join(os.tmpdir(), "main-lib-"));
for (const file of ["pipeline.js", "renderer.js", "templates.js"]) {
  const content = execSync(`git show origin/main:lib/plain-meaning/${file}`, { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 20 }).toString();
  writeFileSync(path.join(mainDir, file), content);
}
const { renderUnit: renderUnitMain } = await import(path.join(mainDir, "renderer.js"));

function actorSwallowedStatus(actor) {
  return /\band$/i.test((actor || "").trim());
}

const STOPWORDS = new Set([
  "this", "that", "these", "those", "which", "shall", "must", "may", "cannot",
  "with", "from", "under", "upon", "into", "been", "were", "than", "such",
  "each", "other", "both", "only", "also", "when", "where", "what", "more",
  "most", "does", "have", "has", "had", "was", "are", "for", "not", "the",
  "and", "any", "all", "its", "his", "her", "their", "who", "whom", "will",
  "would", "should", "could", "section", "subsection", "chapter", "act",
  "person", "persons", "state", "requires", "allows", "prohibits", "because",
]);

function significantWords(text) {
  return [...new Set(
    (text || "")
      .toLowerCase()
      .match(/[a-z]{4,}/g) || []
  )].filter((w) => !STOPWORDS.has(w));
}

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const excludedNumbers = new Set([...(TEST_BILLS_CONFIG.sentinels || []), ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);
const pool = [...new Set(
  BILL_INDEX.map((b) => Number(b.bill_number))
    .filter((n) => !excludedNumbers.has(n))
    .filter((n) => !(n >= 4000 && n <= 4999))
    .filter((n) => !(n >= 8000 && n <= 8999))
)].sort((a, b) => a - b);

const step = Math.max(1, Math.floor(pool.length / SAMPLE_SIZE));
const batch = [];
for (let i = 0; i < pool.length; i += step) batch.push(pool[i]);

const out = [];
const log = (line = "") => out.push(line);

log(`Pool size: ${pool.length}. Sampling every ${step} bills, ${batch.length} bills total.\n`);

let billsFetchedOk = 0;
let totalUnits = 0;
let totalDiffering = 0;
let forceCorrectionCount = 0;
let subjectCarryCount = 0;
let otherDiffCount = 0;
let statusAttachUnits = 0;
let contentLossFlags = 0;
const diffDetails = [];
const contentLossDetails = [];

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
    let iscOutput;
    try {
      iscOutput = runPipeline(section.text);
    } catch (err) {
      continue;
    }
    const units = iscOutput.units || [];
    for (const unit of units) {
      totalUnits++;
      const branchResult = renderUnitBranch(unit);
      const mainResult = renderUnitMain(unit);
      const branchOut = branchResult?.sentence || null;
      const mainOut = mainResult?.sentence || null;

      const isStatusAttach = actorSwallowedStatus(unit.parse?.who?.responsibleParty);
      if (isStatusAttach) statusAttachUnits++;

      if (branchOut === mainOut) continue;
      totalDiffering++;

      let classification = "OTHER";
      const branchLower = (branchOut || "").toLowerCase();
      const mainLower = (mainOut || "").toLowerCase();
      const verbSwap = (a, b) => {
        const strip = (s) => s.replace(/\brequires\b/g, "V").replace(/\ballows\b/g, "V").replace(/\bprohibits\b/g, "V");
        return a && b && strip(a) === strip(b);
      };
      if (verbSwap(branchLower, mainLower)) {
        classification = "FORCE_CORRECTION";
        forceCorrectionCount++;
      } else if (mainLower.startsWith("because") && !branchLower.startsWith("because")) {
        classification = "SUBJECT_CARRY_IMPROVEMENT";
        subjectCarryCount++;
      } else {
        classification = "OTHER";
        otherDiffCount++;
      }

      diffDetails.push({
        bill: billNumber, section: section.id, classification,
        source: unit.tetherAnchor?.sourceDerivedText || null,
        mainOut, branchOut,
      });

      if (isStatusAttach && branchOut) {
        const sourceText = unit.tetherAnchor?.sourceDerivedText || "";
        const sourceWords = significantWords(sourceText);
        const branchWordsLower = branchOut.toLowerCase();
        const missing = sourceWords.filter((w) => !branchWordsLower.includes(w));
        if (missing.length) {
          contentLossFlags++;
          contentLossDetails.push({
            bill: billNumber, section: section.id, source: sourceText,
            branchOut, missing,
          });
        }
      }
    }
  }
}

log(`Bills fetched OK: ${billsFetchedOk}`);
log(`Total units rendered: ${totalUnits}`);
log(`Total units differing branch vs main: ${totalDiffering}`);
log(`  FORCE_CORRECTION (verb-only swap, main was wrong): ${forceCorrectionCount}`);
log(`  SUBJECT_CARRY_IMPROVEMENT (main used Because, branch didn't): ${subjectCarryCount}`);
log(`  OTHER (needs manual review): ${otherDiffCount}`);
log(`Status-attach units (actor swallowed by force-less status clause -- the only path this fix touches): ${statusAttachUnits}`);
log(`Content-loss flags among status-attach units (significant source word missing from branch output): ${contentLossFlags}\n`);

log("─── OTHER-classified diffs (manual review) ───");
for (const d of diffDetails.filter((d) => d.classification === "OTHER")) {
  log(`Bill ${d.bill} / ${d.section}`);
  log(`  SOURCE: ${d.source}`);
  log(`  MAIN:   ${d.mainOut}`);
  log(`  BRANCH: ${d.branchOut}`);
  log("");
}

log("─── Content-loss flags (manual review) ───");
for (const d of contentLossDetails) {
  log(`Bill ${d.bill} / ${d.section}`);
  log(`  SOURCE:  ${d.source}`);
  log(`  BRANCH:  ${d.branchOut}`);
  log(`  MISSING: ${d.missing.join(", ")}`);
  log("");
}

log("─── Sample of SUBJECT_CARRY_IMPROVEMENT diffs (first 20) ───");
for (const d of diffDetails.filter((d) => d.classification === "SUBJECT_CARRY_IMPROVEMENT").slice(0, 20)) {
  log(`Bill ${d.bill} / ${d.section}`);
  log(`  SOURCE: ${d.source}`);
  log(`  MAIN:   ${d.mainOut}`);
  log(`  BRANCH: ${d.branchOut}`);
  log("");
}

writeFileSync(OUTPUT_FILE, out.join("\n"));
console.log(out.join("\n"));
