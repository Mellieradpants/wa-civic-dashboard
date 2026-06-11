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
const TRANSLATIONS_PATH = path.join(__dirname, "../lib/translations.json");
const TRANSLATIONS = JSON.parse(readFileSync(TRANSLATIONS_PATH, "utf8"));

const REQUEST_TIMEOUT_MS = 30000;

// ─── Static boilerplate paragraphs (legitimate cross-section duplicates) ──────

function fillTemplate(tmpl, vars) {
  return String(tmpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function finalizeText(raw) {
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s.endsWith(".") && !s.endsWith(":")) s += ".";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STATIC_PARAGRAPHS = new Set([
  "No obligation or change detected in this section.",
  "This section is repealed and no longer in effect.",
  ...LANGS.map(l => TRANSLATIONS.no_obligation?.[l]).filter(Boolean),
  ...LANGS
    .map(l => TRANSLATIONS.repeal?.[l] ? finalizeText(fillTemplate(TRANSLATIONS.repeal[l], { actor: "This section" })) : null)
    .filter(Boolean),
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
  const notLocalized = responses.filter(r => r.isLocalized === false);
  if (notLocalized.length) {
    const missing = notLocalized.flatMap(r => (r.sentences || []).flatMap(s => s.missingTokens || []));
    return { pass: false, reason: `isLocalized === false; missing tokens: ${missing.join(", ") || "none reported"}` };
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
    return { billNumber, langs: {}, failures };
  }

  const sections = (textData?.sections || []).filter(s => s.text?.trim());
  if (!sections.length) {
    console.log(`    SKIP: no sections found`);
    failures.push({ billNumber, stage: "wa-bill-text", error: "no sections found" });
    return { billNumber, langs: {}, failures };
  }

  // Run plain-meaning pipeline for each section (English)
  const sectionResults = [];
  for (const sec of sections) {
    try {
      const r = await postJSON(`${BASE_URL}/api/plain-meaning`, { text: sec.text });
      sectionResults.push({ units: r.units || [], hasContent: !!r.hasContent, plainMeaning: r.plainMeaning || "" });
    } catch (err) {
      console.log(`    WARN: plain-meaning failed for section ${sec.id} — ${err.message}`);
      failures.push({ billNumber, stage: "plain-meaning", error: `section ${sec.id}: ${err.message}` });
      sectionResults.push({ units: [], hasContent: false, plainMeaning: "" });
    }
  }

  const enSectionsWithContent = sectionResults.filter(r => r.units.length > 0).length;

  // Translate each section into each language
  const langResults = {};
  const missingMap = new Map();
  const empties = [];

  for (const lang of LANGS) {
    let combined = "";
    let langSectionsWithContent = 0;
    const responses = [];

    for (const sec of sectionResults) {
      if (!sec.units.length) continue;
      try {
        const r = await postJSON(`${BASE_URL}/api/translate-selection`, { units: sec.units, lang });
        responses.push(r);
        if (r.hasContent) {
          langSectionsWithContent++;
          if (r.plainMeaning) combined += (combined ? "\n\n" : "") + r.plainMeaning;
        } else {
          empties.push({ lang, emptyReason: r.emptyReason ?? null });
        }
        for (const s of r.sentences || []) {
          if (s.isLocalized === false && s.missingTokens) {
            const key = JSON.stringify(s.missingTokens);
            let entry = missingMap.get(key);
            if (!entry) {
              entry = { missingTokens: s.missingTokens, units: new Set(), langs: new Set() };
              missingMap.set(key, entry);
            }
            entry.units.add(JSON.stringify({ sourceLocation: s.sourceLocation, sourceAction: s.sourceAction }));
            entry.langs.add(lang);
          }
        }
      } catch (err) {
        console.log(`    WARN: translate-selection failed for ${lang} — ${err.message}`);
        failures.push({ billNumber, stage: "translate-selection", lang, error: err.message });
      }
    }

    langResults[lang] = {
      C1: scoreC1(combined, responses),
      C5: scoreC5(combined),
      C6: scoreC6(combined),
      C7: scoreC7(enSectionsWithContent, langSectionsWithContent, lang),
    };
  }

  const ledger = {
    missingWords: [...missingMap.values()].map(e => ({
      missingTokens: e.missingTokens,
      count: e.units.size,
      langs: [...e.langs],
    })),
    empties,
  };

  // Log a one-line summary
  const failCount = Object.values(langResults).flatMap(r => Object.values(r)).filter(c => !c.pass).length;
  console.log(`    ${failCount === 0 ? "PASS" : `${failCount} FAIL(s)`} across 7 languages`);

  return { billNumber, langs: langResults, failures, ledger };
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
    run.bills.push(r);
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
