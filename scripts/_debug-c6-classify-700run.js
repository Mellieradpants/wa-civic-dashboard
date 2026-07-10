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

// Current getAnchorText, post PR #102 fix, copied verbatim.
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

async function getSections(billNumber) {
  const cached = BILL_CORPUS?.get(billNumber);
  if (cached?.sections?.length) return cached.sections;
  const res = await fetch(`${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: "2025-26" })}`);
  if (!res.ok) return null;
  return (await res.json()).sections || null;
}

const targets = ["1433", "5705", "5719", "5738", "5786", "5800", "5801", "5803", "5810"];

for (const billNumber of targets) {
  const sections = (await getSections(billNumber) || []).filter(s => s.text?.trim());
  const sectionPairs = [];
  for (const sec of sections) {
    try {
      const res = await fetch(`${BASE_URL}/api/plain-meaning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sec.text }),
      });
      const r = await res.json();
      sectionPairs.push({ response: r });
    } catch { /* skip failed section */ }
  }

  const entries = [];
  for (const { response } of sectionPairs) {
    if (!response?.plainMeaning) continue;
    for (const p of response.plainMeaning.split("\n\n").map(s => s.trim()).filter(Boolean)) {
      entries.push({ p, anchorText: getAnchorText(p, response) });
    }
  }

  const seen = new Map();
  let reported = false;
  for (const { p, anchorText } of entries) {
    if (STATIC_PARAGRAPHS.has(p)) continue;
    if (seen.has(p)) {
      const firstAnchor = seen.get(p);
      const cleared = firstAnchor != null && anchorText != null && firstAnchor === anchorText;
      if (cleared) continue;
      console.log("=".repeat(80));
      console.log("BILL:", billNumber);
      console.log("Duplicated paragraph:", JSON.stringify(p.slice(0, 100)));
      console.log("firstAnchor:", JSON.stringify(firstAnchor));
      console.log("secondAnchor:", JSON.stringify(anchorText));
      if (firstAnchor == null || anchorText == null) {
        console.log("CLASSIFICATION: unresolved null anchor (not a confirmed genuine difference)");
      } else if (firstAnchor !== anchorText) {
        console.log("CLASSIFICATION: genuine different source text, same output");
      }
      reported = true;
      break;
    }
    seen.set(p, anchorText);
  }
  if (!reported) console.log(billNumber, "— no duplicate reproduced in this isolated re-run (non-deterministic sample composition or already cleared)");
}
