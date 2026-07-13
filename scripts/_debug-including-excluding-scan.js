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

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// Generalizes the may...which/that/who...shall/must pattern to a connector
// that isn't currently detected at all: a first modal, then "including" or
// "excluding", then a second, later modal.
const MODAL_RE = /\b(may|shall|must|cannot)\b/i;
const CONNECTOR_RE = /\b(including|excluding)\b/i;

function matchesPattern(sentence) {
  const modal1Match = MODAL_RE.exec(sentence);
  if (!modal1Match) return false;
  const afterModal1 = sentence.slice(modal1Match.index + modal1Match[0].length);
  const connectorMatch = CONNECTOR_RE.exec(afterModal1);
  if (!connectorMatch) return false;
  const afterConnector = afterModal1.slice(connectorMatch.index + connectorMatch[0].length);
  return MODAL_RE.test(afterConnector);
}

let totalSentences = 0;
let matchCount = 0;
const billsWithMatch = new Set();
const hits = [];

for (const bill of CORPUS) {
  const billNumber = String(bill.bill_number);
  for (const sec of bill.sections || []) {
    if (!sec.text?.trim()) continue;
    for (const sentence of splitSentences(sec.text)) {
      totalSentences++;
      if (matchesPattern(sentence)) {
        matchCount++;
        billsWithMatch.add(billNumber);
        hits.push({ billNumber, sentence });
      }
    }
  }
}

console.log("Total bills in corpus:", CORPUS.length);
console.log("Total sentences scanned:", totalSentences);
console.log();
console.log("Sentences matching the pattern (modal ... including/excluding ... modal):", matchCount);
console.log("Distinct bills containing at least one such sentence:", billsWithMatch.size);
console.log();
console.log("All matching bill numbers:", [...billsWithMatch].join(", "));
console.log();
console.log("Full matched sentences (up to 40):");
for (const hit of hits.slice(0, 40)) {
  console.log("=".repeat(80));
  console.log("BILL:", hit.billNumber);
  console.log(JSON.stringify(hit.sentence));
}
