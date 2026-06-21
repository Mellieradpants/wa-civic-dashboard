#!/usr/bin/env node
// Test harness — runs C1/C4/C5/C6/L1 checks against a local server.
// Usage: node scripts/test-bills.js
// Requires server running at http://localhost:3000

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");

const BASE_URL = "http://localhost:3000";
const BIENNIUM = "2025-26";
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const RESULTS_PATH = path.join(DATA_DIR, "test-results.json");

const REQUEST_TIMEOUT_MS = 30000;

const SAMPLE_SIZE = process.env.TEST_SAMPLE_SIZE ? Number(process.env.TEST_SAMPLE_SIZE) : TEST_BILLS_CONFIG.sampleSize;
const SENTINELS = TEST_BILLS_CONFIG.sentinels;
const KNOWN_BOILERPLATE = TEST_BILLS_CONFIG.knownBoilerplate || [];
const KNOWN_ISSUES = TEST_BILLS_CONFIG.knownIssues || {};

const existing = existsSync(RESULTS_PATH)
  ? JSON.parse(readFileSync(RESULTS_PATH, "utf8"))
  : { runs: [] };

// ─── Round-robin coverage sampling ─────────────────────────────────────────
// Walks the full bill pool in a fixed order so every bill is guaranteed to be
// tested at least once, instead of relying on random sampling.

function buildCoveragePool() {
  const sentinelSet = new Set(SENTINELS);
  const numbers = BILL_INDEX.map(b => Number(b.bill_number)).filter(n => !sentinelSet.has(n));
  return [...new Set(numbers)].sort((a, b) => a - b);
}

const coveragePool = buildCoveragePool();
const cursorStart = existing.coverageCursor || 0;
const fillCount = Math.max(0, SAMPLE_SIZE - SENTINELS.length);
const picked = [];
for (let i = 0; i < fillCount; i++) {
  picked.push(coveragePool[(cursorStart + i) % coveragePool.length]);
}
const cursorEnd = (cursorStart + fillCount) % coveragePool.length;
const passesCompletedThisRun = Math.floor((cursorStart + fillCount) / coveragePool.length);

const billNumbers = [...SENTINELS, ...picked];

// ─── Static boilerplate paragraphs (legitimate cross-section duplicates) ──────
// Exact entries checked first; knownBoilerplate from config matched as prefixes.

const STATIC_PARAGRAPHS = {
  _exact: new Set([
    "No obligation or change detected in this section.",
    "This section is repealed and no longer in effect.",
  ]),
  has(p) {
    return this._exact.has(p) || KNOWN_BOILERPLATE.some(prefix => p.startsWith(prefix));
  },
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Criteria scorers ────────────────────────────────────────────────────────

function scoreC1(text, responses) {
  if (!text || !text.trim()) {
    const reasons = responses.map(r => r.emptyReason).filter(Boolean);
    const detail = reasons.length ? ` (emptyReason: ${reasons.join(", ")})` : "";
    return { pass: false, reason: `output is empty${detail}` };
  }
  if (text.includes("Failure to comply:")) {
    return { pass: false, reason: '"Failure to comply:" found in output' };
  }
  return { pass: true };
}

// L1: position fidelity — does slicing sec.text at a lineage record's own
// recorded [start, end] actually reproduce that record's text? Catches a
// record whose position silently points at the wrong span, as opposed to
// C4 (which only checks the final anchorText survives somewhere in the
// section). Records with position: null (locateFailed) are skipped — those
// are already honestly flagged as unverified, not silently wrong.
// Reads the top-level lineage field so zero-unit sections (no surviving
// units to carry a copy of the chain) are still checked.
function scoreL1(sectionPairs) {
  for (const { sectionText, response } of sectionPairs) {
    const records = response.lineage?.records;
    if (!records) continue;
    for (const r of records) {
      if (r.position == null || r.locateFailed) continue;
      const [start, end] = r.position;
      const slice = sectionText.slice(start, end);
      if (slice !== r.text) {
        const truncate = (s) => `${s.slice(0, 60)}${s.length > 60 ? "…" : ""}`;
        return {
          pass: false,
          reason: `position [${start}, ${end}] (producedBy=${r.producedBy}, id=${r.id}) sliced to "${truncate(slice)}" but record text is "${truncate(r.text)}"`,
        };
      }
    }
  }
  return { pass: true };
}

function scoreC5(text) {
  const m = text.match(/\$\d+,\s\d{3}/);
  if (m) return { pass: false, reason: `Dollar spacing artifact: "${m[0]}"` };
  return { pass: true };
}

// C4 lineage diagnosis — when an anchor can't be found in the source text,
// walk that sentence's lineage chain (via parentNodeId) from the leaf
// (sentence_split) back to the root (sec.text), re-running L1's own
// position-fidelity check at EVERY record in the chain instead of just the
// leaf. The first record where that check fails — or where a known-risk
// step fired (subsection_marker_strip skipped right after a semicolon/
// colon, which is the one place a marker is deliberately left untouched) —
// is the most likely actual point of divergence; everything downstream of
// it just inherited the broken text rather than caused it.
// Position fidelity is checked whitespace-tolerant (collapsing runs to a
// single space before comparing), not byte-exact like L1's own check —
// collapseRunsAndTrim legitimately turns a single "\n" into " " on the very
// first whole-section record, which a contiguous slice can never reproduce
// byte-for-byte even though nothing meaningful changed; C4 itself already
// treats whitespace as insignificant (it's whitespace-normalized before the
// substring check), so this diagnostic should match that same tolerance
// instead of flagging every multi-line section at the same harmless step.
function diagnoseLineageDivergence(sectionText, records, anchorText) {
  const leaf = records.find(r => r.producedBy === "sentence_split" && r.text === anchorText);
  if (!leaf) {
    return "no sentence_split record matches this anchor — divergence is happening somewhere lineage doesn't cover";
  }

  const byId = new Map(records.map(r => [r.id, r]));
  const chain = [];
  for (let r = leaf; r; r = r.parentNodeId == null ? null : byId.get(r.parentNodeId)) {
    chain.push(r);
  }
  chain.reverse(); // root → leaf

  const truncate = (s) => `${s.slice(0, 60)}${s.length > 60 ? "…" : ""}`;
  const collapse = (s) => s.replace(/\s+/g, " ");

  for (const r of chain) {
    if (
      r.producedBy === "subsection_marker_strip" &&
      r.rule === "marker after semicolon/colon — not a sentence boundary" &&
      r.matched === true
    ) {
      return `likely point of divergence: step "${r.producedBy}" (id=${r.id}) — ${r.rule}; text at this step: "${truncate(r.text)}"`;
    }
    if (r.position == null || r.locateFailed) continue;
    const [start, end] = r.position;
    const slice = sectionText.slice(start, end);
    if (collapse(slice) !== collapse(r.text)) {
      return `divergence at step "${r.producedBy}" (id=${r.id}) — position [${start}, ${end}] sliced to "${truncate(slice)}" but record text is "${truncate(r.text)}"`;
    }
  }

  return "lineage chain checks out end-to-end (root to leaf) — divergence is happening somewhere lineage doesn't cover";
}

function scoreC4(sectionPairs) {
  for (const { sectionText, response } of sectionPairs) {
    const normalized = sectionText.replace(/\s+/g, " ");
    for (const s of (response.sentences || [])) {
      if (s.lens === "fallback" || !s.anchorText) continue;
      const anchor = s.anchorText.replace(/\s+/g, " ").trim();
      if (!normalized.includes(anchor)) {
        const records = response.lineage?.records;
        const diagnosis = records
          ? diagnoseLineageDivergence(sectionText, records, s.anchorText)
          : "no lineage data on this response — can't trace divergence";
        return {
          pass: false,
          reason: `anchor not found in source — "${anchor.slice(0, 60)}${anchor.length > 60 ? "…" : ""}" (${diagnosis})`,
        };
      }
    }
  }
  return { pass: true };
}

function scoreC6(text) {
  if (text.includes("bE")) {
    const idx = text.indexOf("bE");
    const ctx = text.slice(Math.max(0, idx - 15), idx + 20);
    return { pass: false, reason: `"bE" artifact: "${ctx}"` };
  }
  const corruptionMatch = text.match(/(^|\n|[.!?]\s)([ЗС] )(?=[A-Za-z])/);
  if (corruptionMatch) {
    const idx = corruptionMatch.index + corruptionMatch[1].length;
    const ctx = text.slice(Math.max(0, idx - 15), idx + 20);
    return { pass: false, reason: `Stray capitalized Cyrillic preposition "${corruptionMatch[2].trim()}": "${ctx}"` };
  }
  if (text.includes("Failure to comply:")) {
    return { pass: false, reason: '"Failure to comply:" found in output' };
  }
  const paragraphs = text.split("\n\n").map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  for (const p of paragraphs) {
    if (STATIC_PARAGRAPHS.has(p)) continue;
    if (seen.has(p)) {
      return { pass: false, reason: `Full duplication: "${p.slice(0, 80)}${p.length > 80 ? "…" : ""}"` };
    }
    seen.add(p);
  }
  return { pass: true };
}

// ─── Cumulative coverage across all runs ──────────────────────────────────────
// A bill can be re-sampled in a later run after the round-robin pool wraps;
// keep its most recent result so cumulative totals reflect current behavior.

function computeCumulativeStats(runs) {
  const latestByBill = new Map();
  for (const run of runs) {
    for (const bill of run.bills) {
      if (Object.keys(bill.results).length) latestByBill.set(bill.billNumber, bill.results);
    }
  }
  const byCheck = {};
  for (const results of latestByBill.values()) {
    for (const [check, result] of Object.entries(results)) {
      if (!byCheck[check]) byCheck[check] = { passed: 0, failed: 0 };
      byCheck[check][result.pass ? "passed" : "failed"]++;
    }
  }
  return { testedBills: latestByBill.size, byCheck };
}

// ─── XFAIL resolution ────────────────────────────────────────────────────────

function resolveKnownIssues(billNumber, rawResults) {
  const knownIssue = KNOWN_ISSUES[String(billNumber)] || {};
  const results = {};
  for (const [check, r] of Object.entries(rawResults)) {
    results[check] = (!r.pass && knownIssue[check])
      ? { pass: true, xfail: knownIssue[check] }
      : r;
  }
  for (const [check, reason] of Object.entries(knownIssue)) {
    if (!(check in results)) results[check] = { pass: true, xfail: reason };
  }
  return results;
}

function logAndReturn(billNumber, results, failures) {
  const xfailCount = Object.values(results).filter(r => r.xfail).length;
  if (xfailCount) {
    console.log(`    PASS (${xfailCount} XFAIL)`);
    for (const [check, result] of Object.entries(results)) {
      if (result.xfail) console.log(`      ${check}: XFAIL — ${result.xfail}`);
    }
  }
  return { billNumber, results, failures };
}

// ─── Per-bill test ────────────────────────────────────────────────────────────

async function testBill(billNumber) {
  console.log(`  Testing bill ${billNumber}…`);

  const failures = [];

  // Fetch bill text sections
  let textData;
  try {
    textData = await getJSON(
      `${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: BIENNIUM })}`
    );
  } catch (err) {
    console.log(`    SKIP: wa-bill-text failed — ${err.message}`);
    failures.push({ billNumber, stage: "wa-bill-text", error: err.message });
    return logAndReturn(billNumber, resolveKnownIssues(billNumber, {}), failures);
  }

  const sections = (textData?.sections || []).filter(s => s.text?.trim());
  if (!sections.length) {
    console.log(`    SKIP: no sections found`);
    failures.push({ billNumber, stage: "wa-bill-text", error: "no sections found" });
    return logAndReturn(billNumber, resolveKnownIssues(billNumber, {}), failures);
  }

  // Run plain-meaning pipeline for each section (English)
  const responses = [];
  const sectionPairs = [];
  let combined = "";
  for (const sec of sections) {
    try {
      const r = await postJSON(`${BASE_URL}/api/plain-meaning`, { text: sec.text });
      responses.push(r);
      sectionPairs.push({ sectionText: sec.text, response: r });
      if (r.plainMeaning) combined += (combined ? "\n\n" : "") + r.plainMeaning;
    } catch (err) {
      console.log(`    WARN: plain-meaning failed for section ${sec.id} — ${err.message}`);
      failures.push({ billNumber, stage: "plain-meaning", error: `section ${sec.id}: ${err.message}` });
    }
  }

  const rawResults = {
    C1: scoreC1(combined, responses),
    C4: scoreC4(sectionPairs),
    C5: scoreC5(combined),
    C6: scoreC6(combined),
    L1: scoreL1(sectionPairs),
  };

  const results = resolveKnownIssues(billNumber, rawResults);

  // Log a one-line summary
  const failCount = Object.values(results).filter(c => !c.pass).length;
  const xfailCount = Object.values(results).filter(c => c.xfail).length;
  const statusLine = failCount > 0 ? `${failCount} FAIL(s)` : xfailCount > 0 ? `PASS (${xfailCount} XFAIL)` : "PASS";
  console.log(`    ${statusLine}`);
  for (const [check, result] of Object.entries(results)) {
    if (!result.pass) console.log(`      ${check}: ${result.reason}`);
    if (result.xfail) console.log(`      ${check}: XFAIL — ${result.xfail}`);
  }

  return { billNumber, results, failures };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const run = { runAt: new Date().toISOString(), cursorStart, cursorEnd, sentinels: SENTINELS, sampledBills: billNumbers, bills: [] };

console.log(`Running tests for ${billNumbers.length} bills in batches of ${BATCH_SIZE}…\n`);

for (let i = 0; i < billNumbers.length; i += BATCH_SIZE) {
  const batch = billNumbers.slice(i, i + BATCH_SIZE);
  console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: bills ${batch.join(", ")}`);

  const batchResults = await Promise.all(batch.map(n => testBill(String(n))));
  for (const r of batchResults) {
    run.bills.push(r);
  }

  if (i + BATCH_SIZE < billNumbers.length) {
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }
}

existing.runs.push(run);
existing.coverageCursor = cursorEnd;
existing.coveragePasses = (existing.coveragePasses || 0) + passesCompletedThisRun;
existing.cumulativeStats = computeCumulativeStats(existing.runs);
writeFileSync(RESULTS_PATH, JSON.stringify(existing, null, 2));

const totalChecks = run.bills.flatMap(b => Object.values(b.results)).length;
const totalFails = run.bills.flatMap(b => Object.values(b.results)).filter(c => !c.pass).length;
const totalXfails = run.bills.flatMap(b => Object.values(b.results)).filter(c => c.xfail).length;

const totalUniqueBills = coveragePool.length + SENTINELS.length;
const allTestedBills = new Set(existing.runs.flatMap(r => r.sampledBills));
const coveragePct = (allTestedBills.size / totalUniqueBills * 100).toFixed(1);

console.log(`\nDone. ${run.bills.length} bills tested, ${totalChecks} checks, ${totalFails} failures${totalXfails ? `, ${totalXfails} expected` : ""}.`);
console.log(`Coverage: ${allTestedBills.size}/${totalUniqueBills} unique bills tested at least once (${coveragePct}%), ${existing.coveragePasses} full pass(es) of the bill pool completed.`);

const { testedBills: cumulativeTested, byCheck: cumulativeByCheck } = existing.cumulativeStats;
const cumulativePct = (cumulativeTested / totalUniqueBills * 100).toFixed(1);
console.log(`Cumulative results across all runs (${cumulativeTested}/${totalUniqueBills} bills, ${cumulativePct}%):`);
for (const [check, { passed, failed }] of Object.entries(cumulativeByCheck)) {
  console.log(`  ${check}: ${passed} passed, ${failed} failed`);
}
console.log(`Results written to ${RESULTS_PATH}`);

console.log("\nFull results (bill-labeled, this run only):");
console.log(JSON.stringify(run.bills, null, 2));
