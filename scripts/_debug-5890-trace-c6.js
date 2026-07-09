import { fetchBillTextData } from "../api/wa-bill-text.js";

const BASE_URL = "http://localhost:3000";

// Copied verbatim from scripts/test-bills.js — not reimplemented, not modified.
const SECTION_PREFIX_RE = /^(?:New law|Amends existing law|Funding|Effective .+) — $/;
function getAnchorText(paragraph, response) {
  const sentences = response?.sentences;
  if (!Array.isArray(sentences)) return { anchor: null, matchType: "no sentences array" };
  for (const s of sentences) {
    if (!s.sentence) continue;
    if (s.sentence === paragraph) return { anchor: s.anchorText ?? null, matchType: "exact match" };
    if (paragraph.endsWith(s.sentence)) {
      const prefix = paragraph.slice(0, paragraph.length - s.sentence.length);
      if (SECTION_PREFIX_RE.test(prefix)) return { anchor: s.anchorText ?? null, matchType: "suffix+prefix match" };
    }
  }
  return { anchor: null, matchType: "NO MATCH FOUND" };
}

const data = await fetchBillTextData("5890", "2025-26");
const targets = ["section_1", "section_2"];

for (const sec of data.sections) {
  if (!targets.includes(sec.id)) continue;
  const res = await fetch(`${BASE_URL}/api/plain-meaning`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sec.text }),
  });
  const json = await res.json();

  console.log("=".repeat(80));
  console.log("SECTION:", sec.id);
  console.log("plainMeaning (raw, JSON-stringified to show embedded newlines):");
  console.log(JSON.stringify(json.plainMeaning));

  console.log("\nsentences[] array (raw):");
  (json.sentences || []).forEach((s, i) => {
    console.log(`  [${i}] sentence: ${JSON.stringify(s.sentence)}`);
    console.log(`      anchorText: ${JSON.stringify(s.anchorText)}`);
    console.log(`      lens: ${s.lens}`);
  });

  console.log('\nParagraphs after plainMeaning.split("\\n\\n") (exact scoreC6 step):');
  const paragraphs = json.plainMeaning.split("\n\n").map(s => s.trim()).filter(Boolean);
  paragraphs.forEach((p, i) => {
    const result = getAnchorText(p, json);
    console.log(`  paragraph[${i}]: ${JSON.stringify(p)}`);
    console.log(`    -> getAnchorText result: anchor=${JSON.stringify(result.anchor)}  via=${result.matchType}`);
  });
}
