// Temporary diagnostic: measure how often locateSentence fails to find a
// split sentence back inside its tracked section text, across a real batch
// of bills. Run with: node scripts/_debug-locate-failure.js [count]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchBillTextData } from "../api/wa-bill-text.js";
import { runPipeline } from "../lib/plain-meaning/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BILL_INDEX = JSON.parse(readFileSync(path.join(__dirname, "../data/wa/bill-index.json"), "utf8"));

const COUNT = Number(process.argv[2] || 100);
const numbers = [...new Set(BILL_INDEX.map((b) => Number(b.bill_number)))].sort((a, b) => a - b).slice(0, COUNT);

let totalSentences = 0;
let totalFailed = 0;
let billsWithFailures = 0;
const examples = [];

for (const billNumber of numbers) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), "2025-26");
  } catch (err) {
    console.log(`SKIP ${billNumber}: ${err.message}`);
    continue;
  }
  let billHadFailure = false;
  for (const sec of data.sections || []) {
    if (!sec.text?.trim()) continue;
    const result = runPipeline(sec.text);
    for (const rec of result.lineage.sentences) {
      totalSentences++;
      if (rec.locateFailed) {
        totalFailed++;
        billHadFailure = true;
        if (examples.length < 20) {
          const normalizedSentence = rec.text.replace(/\s+/g, " ").trim();
          const normalizedSection = sec.text.replace(/\s+/g, " ");
          examples.push({
            billNumber,
            sectionId: sec.id,
            text: rec.text,
            whitespaceOnlyMismatch: normalizedSection.includes(normalizedSentence),
          });
        }
      }
    }
  }
  if (billHadFailure) billsWithFailures++;
}

console.log(`\nBills checked: ${numbers.length}`);
console.log(`Sentences checked: ${totalSentences}`);
console.log(`locateFailed: ${totalFailed} (${((totalFailed / totalSentences) * 100).toFixed(2)}%)`);
console.log(`Bills with at least one failure: ${billsWithFailures}`);
console.log("\nExamples:");
for (const ex of examples) {
  console.log(`--- bill ${ex.billNumber}, section ${ex.sectionId} (whitespaceOnlyMismatch: ${ex.whitespaceOnlyMismatch}) ---`);
  console.log(JSON.stringify(ex.text));
}
