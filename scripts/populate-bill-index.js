// Run with: node scripts/populate-bill-index.js
// Fetches all bills for the 2025-26 WA Legislature session and writes data/wa/bill-index.json.
// Omits plain_meaning_summary and aliases — only fields available directly from the API.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "wa", "bill-index.json");

const YEAR = "2025";
const BIENNIUM = "2025-26";
const SERVICE_URL = "https://wslwebservices.leg.wa.gov/legislationservice.asmx/GetLegislationByYear";

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getTag(xml, tagName) {
  const match = String(xml || "").match(
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i")
  );
  return match ? decodeXml(match[1].trim()) : null;
}

function getBlock(xml, tagName) {
  const match = String(xml || "").match(
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i")
  );
  return match ? match[1] : "";
}

function getAllBlocks(xml, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
  return [...String(xml || "").matchAll(pattern)].map((m) => m[0]);
}

function parseLegislationInfo(block) {
  const billId = getTag(block, "BillId");
  const billNumber = getTag(block, "BillNumber");
  const originalAgency = getTag(block, "OriginalAgency");
  const shortDescription = getTag(block, "ShortDescription");
  const active = getTag(block, "Active");

  if (!billId || !billNumber) return null;
  if (active === "false") return null;

  // CurrentStatus is present in GetLegislation (single bill) but may be absent
  // in the bulk GetLegislationByYear response — handle both cases.
  const currentStatusBlock = getBlock(block, "CurrentStatus");
  const status = currentStatusBlock
    ? (getTag(currentStatusBlock, "HistoryLine") || getTag(currentStatusBlock, "Status") || "")
    : "";

  const billIdDisplay = billId.trim();
  const billIdNormalized = billIdDisplay.replace(/\s+/g, "");

  return {
    bill_id_display: billIdDisplay,
    bill_id_normalized: billIdNormalized,
    bill_number: billNumber,
    chamber: originalAgency || "",
    title: shortDescription || "",
    session: BIENNIUM,
    status,
    source_url: `https://app.leg.wa.gov/billsummary?BillNumber=${billNumber}&Year=${YEAR}`,
    detail_api_path: `/api/wa-bill-detail?billNumber=${billNumber}&biennium=${BIENNIUM}`,
  };
}

async function fallbackToExisting(reason) {
  const exists = await fs.access(OUTPUT_PATH).then(() => true).catch(() => false);
  if (exists) {
    console.warn(`Warning: ${reason}`);
    console.warn(`Keeping existing ${OUTPUT_PATH} — deploy will continue with current index.`);
  } else {
    console.error(`Error: ${reason}`);
    console.error("No existing bill-index.json to fall back to. Exiting.");
    process.exit(1);
  }
}

async function main() {
  console.log(`Fetching 2025-26 session bills from WA Legislature...`);

  const url = `${SERVICE_URL}?${new URLSearchParams({ year: YEAR })}`;

  let response;
  try {
    response = await fetch(url, { headers: { Accept: "text/xml, application/xml, */*" } });
  } catch (err) {
    return fallbackToExisting(`Fetch failed: ${err.message}`);
  }

  if (!response.ok) {
    return fallbackToExisting(`HTTP ${response.status} from WA Legislature API`);
  }

  let xml;
  try {
    xml = await response.text();
  } catch (err) {
    return fallbackToExisting(`Failed to read response body: ${err.message}`);
  }

  console.log(`Received ${(xml.length / 1024).toFixed(1)} KB`);

  const blocks = getAllBlocks(xml, "LegislationInfo");
  console.log(`Found ${blocks.length} LegislationInfo records`);

  if (blocks.length === 0) {
    return fallbackToExisting("Response parsed but contained zero LegislationInfo records.");
  }

  const records = blocks.map(parseLegislationInfo).filter(Boolean);
  records.sort((a, b) => Number(a.bill_number) - Number(b.bill_number));

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(records, null, 2), "utf8");

  console.log(`Wrote ${records.length} records → ${OUTPUT_PATH}`);

  if (records.length > 0) {
    console.log("\nFirst record:");
    console.log(JSON.stringify(records[0], null, 2));
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
