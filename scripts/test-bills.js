#!/usr/bin/env node
// Test harness — runs C1/C5/C6/C7 checks against a local server.
// Usage: node scripts/test-bills.js
// Requires server running at http://localhost:3000

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");

const BASE_URL = "http://localhost:3000";
const BIENNIUM = "2025-26";
const LANGS = ["es", "vi", "ru", "uk", "tl", "so", "ko"];
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

const billNumbers = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const RESULTS_PATH = path.join(DATA_DIR, "test-results.json");

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Criteria scorers ────────────────────────────────────────────────────────

function scoreC1(text) {
  if (!text || !text.trim()) return { pass: false, reason: "output is empty" };
  const qIdx = text.indexOf("[?]");
  if (qIdx >= 0) {
    const ctx = text.slice(Math.max(0, qIdx - 30), qIdx + 30);
    return { pass: false, reason: `[?] found: "${ctx}"` };
  }
  const bIdx = text.indexOf("[!]");
  if (bIdx >= 0) {
    const ctx = text.slice(Math.max(0, bIdx - 30), bIdx + 30);
    return { pass: false, reason: `[!] found: "${ctx}"` };
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
  if (text.includes("З")) {
    const idx = text.indexOf("З");
    const ctx = text.slice(Math.max(0, idx - 15), idx + 20);
    return { pass: false, reason: `Stray Cyrillic "З": "${ctx}"` };
  }
  if (text.includes("Failure to comply:")) {
    return { pass: false, reason: '"Failure to comply:" found in output' };
  }
  const paragraphs = text.split("\n\n").map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  for (const p of paragraphs) {
    if (seen.has(p)) {
      return { pass: false, reason: `Full duplication: "${p.slice(0, 80)}${p.length > 80 ? "…" : ""}"` };
    }
    seen.add(p);
  }
  return { pass: true };
}

function scoreC7(enCount, langCount, lang) {
  if (langCount !== enCount) {
    return {
      pass: false,
      reason: `${lang} produced ${langCount} sections with content, English produced ${enCount}`,
    };
  }
  return { pass: true };
}

// ─── Per-bill test ────────────────────────────────────────────────────────────

async function testBill(billNumber) {
  console.log(`  Testing bill ${billNumber}…`);

  // Fetch bill text sections
  let textData;
  try {
    textData = await getJSON(
      `${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: BIENNIUM })}`
    );
  } catch (err) {
    console.log(`    SKIP: wa-bill-text failed — ${err.message}`);
    return null;
  }

  const sections = (textData?.sections || []).filter(s => s.text?.trim());
  if (!sections.length) {
    console.log(`    SKIP: no sections found`);
    return null;
  }

  // Run plain-meaning pipeline for each section (English)
  const sectionResults = [];
  for (const sec of sections) {
    try {
      const r = await postJSON(`${BASE_URL}/api/plain-meaning`, { text: sec.text });
      sectionResults.push({ units: r.units || [], hasContent: !!r.hasContent, plainMeaning: r.plainMeaning || "" });
    } catch (err) {
      console.log(`    WARN: plain-meaning failed for section ${sec.id} — ${err.message}`);
      sectionResults.push({ units: [], hasContent: false, plainMeaning: "" });
    }
  }

  const enSectionsWithContent = sectionResults.filter(r => r.hasContent).length;
  const enCombined = sectionResults.map(r => r.plainMeaning).filter(Boolean).join("\n\n");

  // Translate each section into each language
  const langResults = {};
  for (const lang of LANGS) {
    let combined = "";
    let langSectionsWithContent = 0;

    for (const sec of sectionResults) {
      if (!sec.units.length) continue;
      try {
        const r = await postJSON(`${BASE_URL}/api/translate-selection`, { units: sec.units, lang });
        if (r.hasContent) {
          langSectionsWithContent++;
          if (r.plainMeaning) combined += (combined ? "\n\n" : "") + r.plainMeaning;
        }
      } catch (err) {
        console.log(`    WARN: translate-selection failed for ${lang} — ${err.message}`);
      }
    }

    langResults[lang] = {
      C1: scoreC1(combined),
      C5: scoreC5(combined),
      C6: scoreC6(combined),
      C7: scoreC7(enSectionsWithContent, langSectionsWithContent, lang),
    };
  }

  // Log a one-line summary
  const failCount = Object.values(langResults).flatMap(r => Object.values(r)).filter(c => !c.pass).length;
  console.log(`    ${failCount === 0 ? "PASS" : `${failCount} FAIL(s)`} across 7 languages`);

  return { billNumber, langs: langResults };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const existing = existsSync(RESULTS_PATH)
  ? JSON.parse(readFileSync(RESULTS_PATH, "utf8"))
  : { runs: [] };

const run = { runAt: new Date().toISOString(), bills: [] };

console.log(`Running tests for ${billNumbers.length} bills in batches of ${BATCH_SIZE}…\n`);

for (let i = 0; i < billNumbers.length; i += BATCH_SIZE) {
  const batch = billNumbers.slice(i, i + BATCH_SIZE);
  console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: bills ${batch.join(", ")}`);

  const batchResults = await Promise.all(batch.map(n => testBill(String(n))));
  for (const r of batchResults) {
    if (r) run.bills.push(r);
  }

  if (i + BATCH_SIZE < billNumbers.length) {
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }
}

existing.runs.push(run);
writeFileSync(RESULTS_PATH, JSON.stringify(existing, null, 2));

const totalChecks = run.bills.flatMap(b => Object.values(b.langs).flatMap(l => Object.values(l))).length;
const totalFails = run.bills.flatMap(b => Object.values(b.langs).flatMap(l => Object.values(l))).filter(c => !c.pass).length;

console.log(`\nDone. ${run.bills.length} bills tested, ${totalChecks} checks, ${totalFails} failures.`);
console.log(`Results written to ${RESULTS_PATH}`);
