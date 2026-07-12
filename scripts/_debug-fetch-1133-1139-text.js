import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");

const CORPUS_PATH = path.join(DATA_DIR, "bill-corpus.json");
const CORPUS = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
const byNumber = new Map(CORPUS.map((b) => [String(b.bill_number), b]));

for (const billNumber of ["1133", "1139"]) {
  const bill = byNumber.get(billNumber);
  console.log("=".repeat(80));
  console.log("BILL", billNumber);
  if (!bill) {
    console.log("  not found in corpus");
    continue;
  }
  for (const sec of bill.sections || []) {
    if (!sec.text?.trim()) continue;
    console.log(`--- section ${sec.id} (Sec. ${sec.sectionNumber}) ---`);
    console.log(JSON.stringify(sec.text));
    console.log();
  }
}
