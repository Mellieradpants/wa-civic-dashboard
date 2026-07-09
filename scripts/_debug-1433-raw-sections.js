import { fetchBillTextData } from "../api/wa-bill-text.js";

const data = await fetchBillTextData("1433", "2025-26");
console.log("sourceUrl:", data.sourceDocument?.url);
console.log("section count:", data.sections.length);

const targets = ["section_44", "section_81", "section_93"];
for (const sec of data.sections) {
  if (targets.includes(sec.id)) {
    console.log("=".repeat(80));
    console.log("id:", sec.id, "sectionNumber:", sec.sectionNumber);
    console.log("RAW TEXT (verbatim, unprocessed):");
    console.log(sec.text);
  }
}
