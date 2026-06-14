#!/usr/bin/env node
// Test harness — runs C1/C5/C6 checks against a local server.
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

const SEED = process.env.TEST_SEED ? Number(process.env.TEST_SEED) : Date.now();
const SAMPLE_SIZE = process.env.TEST_SAMPLE_SIZE ? Number(process.env.TEST_SAMPLE_SIZE) : TEST_BILLS_CONFIG.sampleSize;
const SENTINELS = TEST_BILLS_CONFIG.sentinels;

// ─── Seeded sampling ──────────────────────────────────────────────────────────

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleBills() {
  const rng = mulberry32(SEED);
  const sentinelSet = new Set(SENTINELS);
  const pool = BILL_INDEX.map(b => Number(b.bill_number)).filter(n => !sentinelSet.has(n));

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const fillCount = Math.max(0, SAMPLE_SIZE - SENTINELS.length);
  return [...SENTINELS, ...pool.slice(0, fillCount)];
}

const billNumbers = sampleBills();

// ─── Static boilerplate paragraphs (legitimate cross-section duplicates) ──────

const STATIC_PARAGRAPHS = new Set([
  "No obligation or change detected in this section.",
  "This section is repealed and no longer in effect.",
]);

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

function scoreC5(text) {
  const m = text.match(/\$\d+,\s\d{3}/);
  if (m) return { pass: false, reason: `Dollar spacing artifact: "${m[0]}"` };
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
    return { billNumber, results: {}, failures };
  }

  const sections = (textData?.sections || []).filter(s => s.text?.trim());
  if (!sections.length) {
    console.log(`    SKIP: no sections found`);
    failures.push({ billNumber, stage: "wa-bill-text", error: "no sections found" });
    return { billNumber, results: {}, failures };
  }

  // Run plain-meaning pipeline for each section (English)
  const responses = [];
  let combined = "";
  for (const sec of sections) {
    try {
      const r = await postJSON(`${BASE_URL}/api/plain-meaning`, { text: sec.text });
      responses.push(r);
      if (r.plainMeaning) combined += (combined ? "\n\n" : "") + r.plainMeaning;
    } catch (err) {
      console.log(`    WARN: plain-meaning failed for section ${sec.id} — ${err.message}`);
      failures.push({ billNumber, stage: "plain-meaning", error: `section ${sec.id}: ${err.message}` });
    }
  }

  const results = {
    C1: scoreC1(combined, responses),
    C5: scoreC5(combined),
    C6: scoreC6(combined),
  };

  // Log a one-line summary
  const failCount = Object.values(results).filter(c => !c.pass).length;
  console.log(`    ${failCount === 0 ? "PASS" : `${failCount} FAIL(s)`}`);

  return { billNumber, results, failures };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const existing = existsSync(RESULTS_PATH)
  ? JSON.parse(readFileSync(RESULTS_PATH, "utf8"))
  : { runs: [] };

const run = { runAt: new Date().toISOString(), seed: SEED, sentinels: SENTINELS, sampledBills: billNumbers, bills: [] };

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
writeFileSync(RESULTS_PATH, JSON.stringify(existing, null, 2));

const totalChecks = run.bills.flatMap(b => Object.values(b.results)).length;
const totalFails = run.bills.flatMap(b => Object.values(b.results)).filter(c => !c.pass).length;

console.log(`\nDone. ${run.bills.length} bills tested, ${totalChecks} checks, ${totalFails} failures.`);
console.log(`Results written to ${RESULTS_PATH}`);
