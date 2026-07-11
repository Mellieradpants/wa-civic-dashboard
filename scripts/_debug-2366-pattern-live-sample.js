import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const PROD_URL = "https://https-github-com-mellieradpants-wa-civic.onrender.com";
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 20;

const MAY_RE = /\bmay\b(?!\s+not\b)/i;
const RELATIVE_RE = /\b(which|that|who)\b/i;
const OBLIGATION_WORD_RE = /\b(shall|must)\b/i;

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

function matchesPattern(sentence) {
  const mayMatch = MAY_RE.exec(sentence);
  if (!mayMatch) return false;
  const afterMay = sentence.slice(mayMatch.index + mayMatch[0].length);
  const relMatch = RELATIVE_RE.exec(afterMay);
  if (!relMatch) return false;
  const afterRel = afterMay.slice(relMatch.index + relMatch[0].length);
  return OBLIGATION_WORD_RE.test(afterRel);
}

function normalize(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}

function findMatchingEntry(sourceSentence, sentences) {
  const norm = normalize(sourceSentence);
  for (const s of sentences || []) {
    if (!s.anchorText) continue;
    const anchorNorm = normalize(s.anchorText);
    if (anchorNorm === norm || norm.includes(anchorNorm) || anchorNorm.includes(norm)) return s;
  }
  return null;
}

const indexRaw = readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8");
const index = JSON.parse(indexRaw);
const distinctBillNumbers = [...new Set(index.map((b) => b.bill_number))];

const sample = [];
const pool = [...distinctBillNumbers];
for (let i = 0; i < SAMPLE_SIZE && pool.length; i++) {
  const idx = Math.floor(Math.random() * pool.length);
  sample.push(pool.splice(idx, 1)[0]);
}

console.log("Sampled bill numbers:", sample.join(", "));
console.log();

let billsWithPattern = 0;
let confirmedFlips = 0;
let renderedCorrectly = 0;
let totalMatchedSentences = 0;

for (const billNumber of sample) {
  console.log("=".repeat(80));
  console.log(`BILL ${billNumber}`);

  let sections;
  try {
    const res = await fetch(`${PROD_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: BIENNIUM })}`);
    if (!res.ok) {
      console.log(`  Source text fetch failed: HTTP ${res.status}`);
      continue;
    }
    sections = (await res.json()).sections || [];
  } catch (err) {
    console.log(`  Source text fetch error: ${err.message}`);
    continue;
  }

  let billHasPattern = false;

  for (const sec of sections) {
    if (!sec.text?.trim()) continue;
    const matchingSentences = splitSentences(sec.text).filter(matchesPattern);
    if (!matchingSentences.length) continue;

    let response;
    try {
      const res = await fetch(`${PROD_URL}/api/plain-meaning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sec.text }),
      });
      response = await res.json();
    } catch (err) {
      console.log(`  [section ${sec.id}] plain-meaning fetch error: ${err.message}`);
      continue;
    }

    for (const sourceSentence of matchingSentences) {
      billHasPattern = true;
      totalMatchedSentences++;
      const entry = findMatchingEntry(sourceSentence, response?.sentences);

      console.log(`\n  --- Section ${sec.id}, matched sentence ---`);
      console.log(`  SOURCE:   ${JSON.stringify(sourceSentence)}`);
      if (!entry) {
        console.log(`  RENDERED: no matching sentences[] entry found (sentence may have been dropped or split)`);
        continue;
      }
      console.log(`  RENDERED: ${JSON.stringify(entry.sentence)}`);
      console.log(`  signal: ${entry.signal}`);

      const sourceHasMay = MAY_RE.test(sourceSentence);
      const renderedHasMust = /\bmust\b/i.test(entry.sentence || "");
      const renderedHasMay = /\bmay\b/i.test(entry.sentence || "");
      const flipped = sourceHasMay && entry.signal === "obligation" && renderedHasMust && !renderedHasMay;

      if (flipped) {
        confirmedFlips++;
        console.log(`  VERDICT: flip confirmed (source "may" rendered as "must")`);
      } else {
        renderedCorrectly++;
        console.log(`  VERDICT: no flip (permission preserved, or pattern didn't manifest in this entry)`);
      }
    }
  }

  if (billHasPattern) billsWithPattern++;
  else console.log("  No matching pattern found in this bill's source text.");
}

console.log("\n" + "=".repeat(80));
console.log("SUMMARY");
console.log(`Bills sampled: ${sample.length}`);
console.log(`Bills containing at least one matching sentence: ${billsWithPattern}`);
console.log(`Total matching sentences found across those bills: ${totalMatchedSentences}`);
console.log(`Confirmed flips (source "may" rendered as "must"): ${confirmedFlips}`);
console.log(`Rendered correctly despite matching the pattern: ${renderedCorrectly}`);
