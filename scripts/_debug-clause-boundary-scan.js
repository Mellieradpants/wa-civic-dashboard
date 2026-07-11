import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");

const CORPUS_PATH = path.join(DATA_DIR, "bill-corpus.json");
if (!existsSync(CORPUS_PATH)) {
  console.log("No bill-corpus.json available — cannot run a real corpus-wide count.");
  process.exit(1);
}
const CORPUS = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

// Verbatim from lib/plain-meaning/pipeline.js
const OBLIGATION_RE =
  /\bshall\b|\bmust\b|\brequired to\b|\bis required\b|\bare required\b|\bobligated to\b|\bis responsible for\b|\bare responsible for\b|\bmust be rounded\b|\bmust be adjusted\b|\bshall be rounded\b|\bshall be adjusted\b|\bis repealed\b|\bare each repealed\b|\bis(?:\s+hereby)?\s+appropriated\b/i;
const PERMISSION_RE =
  /(?<!\bmay not\b.{0,20})\bmay\b(?!\s+not\b)|\bpermitted to\b|\bauthorized to\b|\bis allowed\b/i;
const PROHIBITION_RE =
  /\bmay not\b|\bmust not\b|\bshall not\b|\bcannot\b|\bis prohibited\b|\bare prohibited\b|\bprohibited from\b/i;

function detectSignal(text) {
  if (PROHIBITION_RE.test(text)) return "prohibition";
  if (OBLIGATION_RE.test(text)) return "obligation";
  if (PERMISSION_RE.test(text)) return "permission";
  return null;
}

// Verbatim from lib/plain-meaning/pipeline.js
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// The specific structural pattern under review: a permission modal ("may"),
// followed later in the same sentence by a relative clause marker
// (which/that/who), followed later still by an obligation modal (shall/must)
// inside that relative clause.
const MAY_RE = /\bmay\b(?!\s+not\b)/i;
const RELATIVE_RE = /\b(which|that|who)\b/i;
const OBLIGATION_WORD_RE = /\b(shall|must)\b/i;

function matchesClauseBoundaryPattern(sentence) {
  const mayMatch = MAY_RE.exec(sentence);
  if (!mayMatch) return false;
  const afterMay = sentence.slice(mayMatch.index + mayMatch[0].length);
  const relMatch = RELATIVE_RE.exec(afterMay);
  if (!relMatch) return false;
  const afterRel = afterMay.slice(relMatch.index + relMatch[0].length);
  return OBLIGATION_WORD_RE.test(afterRel);
}

let totalSentences = 0;
let bothSignalsCount = 0; // sentences matching both OBLIGATION_RE and PERMISSION_RE (signal gets silently overridden to "obligation")
let clauseBoundaryCount = 0; // the specific may...which/that/who...shall/must pattern
const clauseBoundaryHits = [];
const billsWithClauseBoundaryHit = new Set();

for (const bill of CORPUS) {
  const billNumber = String(bill.bill_number);
  for (const sec of bill.sections || []) {
    if (!sec.text?.trim()) continue;
    for (const sentence of splitSentences(sec.text)) {
      totalSentences++;
      const signal = detectSignal(sentence);
      if (signal === "obligation" && PERMISSION_RE.test(sentence)) {
        bothSignalsCount++;
      }
      if (matchesClauseBoundaryPattern(sentence)) {
        clauseBoundaryCount++;
        billsWithClauseBoundaryHit.add(billNumber);
        if (clauseBoundaryHits.length < 25) {
          clauseBoundaryHits.push({ billNumber, sentence: sentence.slice(0, 200) });
        }
      }
    }
  }
}

console.log("Total bills in corpus:", CORPUS.length);
console.log("Total sentences scanned:", totalSentences);
console.log();
console.log("Sentences where OBLIGATION_RE and PERMISSION_RE both match (signal silently forced to 'obligation'):", bothSignalsCount);
console.log();
console.log("Sentences matching the exact structural pattern (may ... which/that/who ... shall/must):", clauseBoundaryCount);
console.log("Distinct bills containing at least one such sentence:", billsWithClauseBoundaryHit.size);
console.log();
console.log("Up to 25 example matches:");
for (const hit of clauseBoundaryHits) {
  console.log(`  [bill ${hit.billNumber}] ${JSON.stringify(hit.sentence)}`);
}
