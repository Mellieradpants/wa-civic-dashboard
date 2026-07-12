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

const PROHIBITION_RE =
  /\bmay not\b|\bmust not\b|\bshall not\b|\bcannot\b|\bis prohibited\b|\bare prohibited\b|\bprohibited from\b/i;

async function getSections(billNumber) {
  const cached = BILL_CORPUS?.get(billNumber);
  if (cached?.sections?.length) return { sections: cached.sections, source: "corpus" };
  const res = await fetch(`${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: "2025-26" })}`);
  if (!res.ok) return { sections: null, source: "live-failed", status: res.status };
  return { sections: (await res.json()).sections || null, source: "live" };
}

const billNumber = "5380";
const { sections, source, status } = await getSections(billNumber);
console.log("Text source:", source, status ?? "");
console.log("Section count:", sections?.length ?? 0);

const sec5 = sections?.find(s => s.id === "section_5" || String(s.sectionNumber) === "5");
if (!sec5) {
  console.log("Section 5 not found. All section ids/numbers:");
  for (const s of sections || []) console.log(" ", s.id, "/ Sec.", s.sectionNumber);
  process.exit(0);
}

console.log("\n=== FULL RAW TEXT OF SECTION 5 ===");
console.log(JSON.stringify(sec5.text));

console.log("\n=== PROHIBITION_RE match check ===");
const match = PROHIBITION_RE.exec(sec5.text);
if (match) {
  const idx = match.index;
  console.log("Matched phrase:", JSON.stringify(match[0]));
  console.log("Context:", JSON.stringify(sec5.text.slice(Math.max(0, idx - 100), idx + 150)));
} else {
  console.log("No PROHIBITION_RE match found in section 5 text at all.");
}

console.log("\n=== Real rendered output from /api/plain-meaning (current merged main) ===");
const res = await fetch(`${BASE_URL}/api/plain-meaning`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: sec5.text }),
});
const r = await res.json();
console.log("Full plainMeaning:");
console.log(r.plainMeaning);
console.log("\nsentences[] entries mentioning 'ecology' or 'notice' or 'fee' or 'board':");
for (const s of r.sentences || []) {
  const hay = `${s.sentence || ""} ${s.anchorText || ""}`.toLowerCase();
  if (hay.includes("ecology") || hay.includes("notice") || hay.includes("fee")) {
    console.log(JSON.stringify(s, null, 2));
  }
}
