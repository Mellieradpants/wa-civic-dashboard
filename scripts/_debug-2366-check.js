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

async function getSections(billNumber) {
  const cached = BILL_CORPUS?.get(billNumber);
  if (cached?.sections?.length) return { sections: cached.sections, source: "corpus" };
  const res = await fetch(`${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: "2025-26" })}`);
  if (!res.ok) return { sections: null, source: "live-failed", status: res.status };
  return { sections: (await res.json()).sections || null, source: "live" };
}

const billNumber = "2366";
const NEEDLE = "may be advanced sufficient sums to cover their anticipated expenses";

const { sections, source, status } = await getSections(billNumber);
console.log("Text source:", source, status ?? "");
console.log("Section count:", sections?.length ?? 0);

if (!sections) {
  console.log("Could not fetch bill 2366 sections at all.");
  process.exit(0);
}

const matchingSections = sections.filter(s => s.text?.includes(NEEDLE));
console.log(`Sections whose raw source text contains the needle: ${matchingSections.length}`);
for (const s of matchingSections) console.log(`  section id: ${s.id}, sectionNumber: ${s.sectionNumber}`);

if (!matchingSections.length) {
  console.log("\nNEEDLE NOT FOUND in any section's raw source text — cannot proceed.");
  console.log("Dumping all section ids/numbers for reference:");
  for (const s of sections) console.log(`  ${s.id} / Sec. ${s.sectionNumber}`);
  process.exit(0);
}

for (const sec of matchingSections) {
  console.log("\n" + "=".repeat(80));
  console.log(`SECTION ${sec.id} (Sec. ${sec.sectionNumber})`);
  const idx = sec.text.indexOf(NEEDLE);
  console.log("Raw source context:", JSON.stringify(sec.text.slice(Math.max(0, idx - 150), idx + 250)));

  const res = await fetch(`${BASE_URL}/api/plain-meaning`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sec.text }),
  });
  const r = await res.json();

  console.log("\n--- Full plainMeaning for this section ---");
  console.log(r.plainMeaning);

  console.log("\n--- sentences[] entries whose sentence or anchorText mention 'advanced' or 'expenses' or 'auditor' ---");
  for (const s of r.sentences || []) {
    const hay = `${s.sentence || ""} ${s.anchorText || ""}`.toLowerCase();
    if (hay.includes("advanced") || hay.includes("anticipated expenses") || hay.includes("state auditor")) {
      console.log(JSON.stringify(s, null, 2));
    }
  }
}
