import { fetchBillTextData } from "../api/wa-bill-text.js";

const billNumber = process.argv[2] || "5890";
const biennium = process.argv[3] || "2025-26";

const data = await fetchBillTextData(billNumber, biennium);
console.log("SOURCE_URL:", data.sourceDocument.url);
console.log("SECTION_COUNT:", data.sections.length);
for (const s of data.sections) {
  console.log("=====SECTION_START=====");
  console.log("id:", s.id, "sectionNumber:", s.sectionNumber, "isNewSection:", s.isNewSection);
  console.log(s.text);
  console.log("=====SECTION_END=====");
}
