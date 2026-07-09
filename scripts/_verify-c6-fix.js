import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BASE_URL = "http://localhost:3000";

const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const KNOWN_BOILERPLATE = TEST_BILLS_CONFIG.knownBoilerplate || [];
const SENTINELS = TEST_BILLS_CONFIG.sentinels || [];

const CORPUS_PATH = path.join(DATA_DIR, "bill-corpus.json");
const BILL_CORPUS = existsSync(CORPUS_PATH)
  ? new Map(JSON.parse(readFileSync(CORPUS_PATH, "utf8")).map(b => [String(b.bill_number), b]))
  : null;

const results = JSON.parse(readFileSync(path.join(DATA_DIR, "test-results.json"), "utf8"));
const testedBillNumbers = results.cumulativeStats.testedBillNumbers;

// Sample: all sentinels first (guarantees 5890 and 1433 are included), then
// fill up to 500 with already-tested bills from the real cumulative record.
const sampleSet = new Set(SENTINELS.map(String));
for (const n of testedBillNumbers) {
  if (sampleSet.size >= 500) break;
  sampleSet.add(String(n));
}
const sample = [...sampleSet];
console.log("SAMPLE_SIZE:", sample.length);
console.log("includes 5890:", sample.includes("5890"), "includes 1433:", sample.includes("1433"));

const STATIC_PARAGRAPHS = {
  _exact: new Set([
    "No obligation or change detected in this section.",
    "This section is repealed and no longer in effect.",
  ]),
  has(p) {
    return this._exact.has(p) || KNOWN_BOILERPLATE.some(prefix => p.startsWith(prefix));
  },
};

const SECTION_PREFIX_RE = /^(?:New law|Amends existing law|Funding|Effective .+) — $/;

// OLD — exactly as it exists on main today.
function getAnchorTextOld(paragraph, response) {
  const sentences = response?.sentences;
  if (!Array.isArray(sentences)) return null;
  for (const s of sentences) {
    if (!s.sentence) continue;
    if (s.sentence === paragraph) return s.anchorText ?? null;
    if (paragraph.endsWith(s.sentence)) {
      const prefix = paragraph.slice(0, paragraph.length - s.sentence.length);
      if (SECTION_PREFIX_RE.test(prefix)) return s.anchorText ?? null;
    }
  }
  return null;
}

// NEW — exactly as added on fix-compound-split-anchor-match.
function getAnchorTextNew(paragraph, response) {
  const sentences = response?.sentences;
  if (!Array.isArray(sentences)) return null;
  for (const s of sentences) {
    if (!s.sentence) continue;
    if (s.sentence === paragraph) return s.anchorText ?? null;
    if (paragraph.endsWith(s.sentence)) {
      const prefix = paragraph.slice(0, paragraph.length - s.sentence.length);
      if (SECTION_PREFIX_RE.test(prefix)) return s.anchorText ?? null;
    }
    if (s.sentence.includes("\n\n")) {
      const clauses = s.sentence.split("\n\n").map(c => c.trim());
      if (clauses.includes(paragraph)) return s.anchorText ?? null;
    }
  }
  return null;
}

function scoreC6WithMatcher(text, sectionPairs, matcher) {
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
  const entries = [];
  if (Array.isArray(sectionPairs) && sectionPairs.length) {
    for (const { response } of sectionPairs) {
      if (!response?.plainMeaning) continue;
      for (const p of response.plainMeaning.split("\n\n").map(s => s.trim()).filter(Boolean)) {
        entries.push({ p, anchorText: matcher(p, response) });
      }
    }
  } else {
    for (const p of text.split("\n\n").map(s => s.trim()).filter(Boolean)) {
      entries.push({ p, anchorText: null });
    }
  }
  const seen = new Map();
  for (const { p, anchorText } of entries) {
    if (STATIC_PARAGRAPHS.has(p)) continue;
    if (seen.has(p)) {
      const firstAnchor = seen.get(p);
      if (firstAnchor != null && anchorText != null && firstAnchor === anchorText) continue;
      return { pass: false, reason: `Full duplication: "${p.slice(0, 80)}${p.length > 80 ? "…" : ""}"` };
    }
    seen.set(p, anchorText);
  }
  return { pass: true };
}

async function getSectionsFor(billNumber) {
  const cached = BILL_CORPUS?.get(billNumber);
  if (cached?.sections?.length) return cached.sections;
  const res = await fetch(`${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: "2025-26" })}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.sections || null;
}

let oldFail = 0, newFail = 0;
const cleared = [];
const stillFailingBoth = [];
const newlyBroken = [];
const untestable = [];

for (const billNumber of sample) {
  const sections = (await getSectionsFor(billNumber) || []).filter(s => s.text?.trim());
  if (!sections.length) { untestable.push(billNumber); continue; }

  const sectionPairs = [];
  let combined = "";
  for (const sec of sections) {
    try {
      const res = await fetch(`${BASE_URL}/api/plain-meaning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sec.text }),
      });
      const r = await res.json();
      sectionPairs.push({ sectionText: sec.text, response: r });
      if (r.plainMeaning) combined += (combined ? "\n\n" : "") + r.plainMeaning;
    } catch {
      // section failed to render; skip it for this comparison
    }
  }
  if (!sectionPairs.length) { untestable.push(billNumber); continue; }

  const before = scoreC6WithMatcher(combined, sectionPairs, getAnchorTextOld);
  const after = scoreC6WithMatcher(combined, sectionPairs, getAnchorTextNew);

  if (!before.pass) oldFail++;
  if (!after.pass) newFail++;

  if (!before.pass && after.pass) cleared.push({ billNumber, reason: before.reason });
  if (!before.pass && !after.pass) stillFailingBoth.push({ billNumber, beforeReason: before.reason, afterReason: after.reason });
  if (before.pass && !after.pass) newlyBroken.push({ billNumber, reason: after.reason });
}

console.log("\n=== RESULTS ===");
console.log("Bills actually scored:", sample.length - untestable.length, "(untestable/skipped:", untestable.length, ")");
console.log("C6 fail count BEFORE (old getAnchorText):", oldFail);
console.log("C6 fail count AFTER  (new getAnchorText):", newFail);
console.log("\nCleared by the fix (" + cleared.length + "):");
for (const c of cleared) console.log("  " + c.billNumber + " — was: " + c.reason);
console.log("\nStill failing under BOTH old and new (" + stillFailingBoth.length + "):");
for (const s of stillFailingBoth) console.log("  " + s.billNumber + " — before: " + s.beforeReason + " | after: " + s.afterReason);
console.log("\nNewly broken by the fix, should be empty (" + newlyBroken.length + "):");
for (const n of newlyBroken) console.log("  " + n.billNumber + " — " + n.reason);

console.log("\n=== SPOT CHECKS ===");
console.log("5890 in cleared list:", cleared.some(c => c.billNumber === "5890"));
console.log("1433 in stillFailingBoth list:", stillFailingBoth.some(s => s.billNumber === "1433"));
console.log("1433 in cleared list (should be false):", cleared.some(c => c.billNumber === "1433"));
