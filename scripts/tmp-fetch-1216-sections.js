#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Prints the full real text of a range of sections from a single bill,
// verbatim, for direct human review — no pipeline processing involved.

import { fetchBillTextData } from "../api/wa-bill-text.js";

const BILL_NUMBER = process.env.SCAN_BILL_NUMBER || "1216";
const BIENNIUM = "2025-26";
const SECTION_IDS = (process.env.SCAN_SECTION_IDS || "section_8028,section_8029,section_8030,section_8031,section_8032").split(",");

const data = await fetchBillTextData(BILL_NUMBER, BIENNIUM);

console.log(`Bill ${BILL_NUMBER}, ${data.sections.length} total sections fetched.\n`);

for (const id of SECTION_IDS) {
  const section = data.sections.find((s) => s.id === id);
  console.log(`===== ${id} =====`);
  if (!section) {
    console.log("(no section with this id)\n");
    continue;
  }
  console.log(`sectionNumber: ${section.sectionNumber}, isNewSection: ${section.isNewSection}, characterCount: ${section.characterCount}`);
  console.log("--- full text ---");
  console.log(section.text);
  console.log();
}
