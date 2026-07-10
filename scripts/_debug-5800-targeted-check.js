import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BASE_URL = "http://localhost:3000";

const CORPUS_PATH = path.join(DATA_DIR, "bill-corpus.json");
const BILL_CORPUS = existsSync(CORPUS_PATH)
  ? new Map(JSON.parse(readFileSync(CORPUS_PATH, "utf8")).map(b => [String(b.bill_number), b]))
  : null;

const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const KNOWN_BOILERPLATE = TEST_BILLS_CONFIG.knownBoilerplate || [];

// Verbatim copy of the merged fix from scripts/test-bills.js (main, post-PR #105).
const PREFIXED_NO_OBLIGATION_RE = /^(?:New law|Amends existing law|Funding|Effective [^—\n]+) — No obligation or change detected in this section\.$/;

const STATIC_PARAGRAPHS = {
  _exact: new Set([
    "No obligation or change detected in this section.",
    "This section is repealed and no longer in effect.",
  ]),
  has(p) {
    return this._exact.has(p) || PREFIXED_NO_OBLIGATION_RE.test(p) || KNOWN_BOILERPLATE.some(prefix => p.startsWith(prefix));
  },
};

const SECTION_PREFIX_RE = /^(?:New law|Amends existing law|Funding|Effective .+) — $/;

function getAnchorText(paragraph, response) {
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

// Verbatim copy of scoreC6 from scripts/test-bills.js (main, post-PR #105),
// minus the corruption/artifact checks that are irrelevant to this check.
function scoreC6(sectionPairs) {
  const entries = [];
  for (const { response } of sectionPairs) {
    if (!response?.plainMeaning) continue;
    for (const p of response.plainMeaning.split("\n\n").map(s => s.trim()).filter(Boolean)) {
      entries.push({ p, anchorText: getAnchorText(p, response) });
    }
  }

  const seen = new Map();
  const skippedAsStatic = [];
  for (const { p, anchorText } of entries) {
    if (STATIC_PARAGRAPHS.has(p)) {
      if (seen.has(p) || entries.filter(e => e.p === p).length > 1) skippedAsStatic.push(p);
      continue;
    }
    if (seen.has(p)) {
      const firstAnchor = seen.get(p);
      if (firstAnchor != null && anchorText != null && firstAnchor === anchorText) continue;
      return { pass: false, reason: `Full duplication: "${p.slice(0, 80)}${p.length > 80 ? "…" : ""}"`, skippedAsStatic };
    }
    seen.set(p, anchorText);
  }
  return { pass: true, skippedAsStatic };
}

async function getSections(billNumber) {
  const cached = BILL_CORPUS?.get(billNumber);
  if (cached?.sections?.length) return { sections: cached.sections, source: "corpus" };
  const res = await fetch(`${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: "2025-26" })}`);
  if (!res.ok) return { sections: null, source: "live-failed" };
  return { sections: (await res.json()).sections || null, source: "live" };
}

const billNumber = "5800";
const { sections, source } = await getSections(billNumber);
console.log("Text source:", source);
console.log("Section count:", sections?.length ?? 0);

const usableSections = (sections || []).filter(s => s.text?.trim());
const sectionPairs = [];
for (const sec of usableSections) {
  const res = await fetch(`${BASE_URL}/api/plain-meaning`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sec.text }),
  });
  const r = await res.json();
  sectionPairs.push({ sectionId: sec.id, response: r });
}

// Raw paragraph list before any STATIC_PARAGRAPHS filtering, so we can see
// directly whether the duplicate condition still occurs at all.
const rawParagraphs = [];
for (const { sectionId, response } of sectionPairs) {
  if (!response?.plainMeaning) continue;
  for (const p of response.plainMeaning.split("\n\n").map(s => s.trim()).filter(Boolean)) {
    rawParagraphs.push({ sectionId, p });
  }
}

console.log("\n=== Raw paragraphs (pre-filter) ===");
for (const { sectionId, p } of rawParagraphs) {
  console.log(`[${sectionId}] ${JSON.stringify(p.slice(0, 90))}`);
}

const noObligationOccurrences = rawParagraphs.filter(({ p }) => PREFIXED_NO_OBLIGATION_RE.test(p) || p === "No obligation or change detected in this section.");
console.log(`\nOccurrences matching the no-obligation boilerplate (any prefix): ${noObligationOccurrences.length}`);
for (const { sectionId, p } of noObligationOccurrences) console.log(`  [${sectionId}] ${JSON.stringify(p)}`);

const result = scoreC6(sectionPairs);
console.log("\n=== scoreC6 result (verbatim logic from main) ===");
console.log(JSON.stringify(result, null, 2));

console.log("\n=== Verdict ===");
if (noObligationOccurrences.length < 2) {
  console.log("The duplicate condition did not reproduce in this run (fewer than 2 occurrences) — cannot confirm the fix from this run.");
} else if (result.pass && result.skippedAsStatic?.length) {
  console.log("CONFIRMED: duplicate occurred, STATIC_PARAGRAPHS.has() matched it via PREFIXED_NO_OBLIGATION_RE, scoreC6 passed because of the fix.");
} else if (result.pass) {
  console.log("Passed, but skippedAsStatic is empty — duplicate paragraphs existed but weren't caught by the static-paragraph fix. Needs investigation.");
} else {
  console.log("FAILED — the fix did not resolve this case. Reason: " + result.reason);
}
