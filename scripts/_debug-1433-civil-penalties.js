import { fetchBillTextData } from "../api/wa-bill-text.js";

const BASE_URL = "http://localhost:3000";
const NEEDLE = "impose civil penalties";

const data = await fetchBillTextData("1433", "2025-26");
console.log("sourceUrl:", data.sourceDocument?.url);
console.log("section count:", data.sections.length);

const matches = [];
for (const sec of data.sections) {
  if (!sec.text?.trim()) continue;
  const res = await fetch(`${BASE_URL}/api/plain-meaning`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sec.text }),
  });
  const json = await res.json();
  for (const s of json.sentences || []) {
    const sentence = s.sentence || "";
    const anchor = s.anchorText || "";
    if (sentence.toLowerCase().includes(NEEDLE) || anchor.toLowerCase().includes(NEEDLE)) {
      matches.push({
        sectionId: sec.id,
        sectionNumber: sec.sectionNumber,
        rendered: sentence,
        anchorText: anchor,
      });
    }
  }
}

console.log("MATCH_COUNT:", matches.length);
console.log(JSON.stringify(matches, null, 2));
