// Run with: node scripts/populate-bill-index.js
// Fetches all bills for the 2025-26 WA Legislature session, generates plain-language
// keywords for each bill via Anthropic, and writes data/wa/bill-index.json.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "wa", "bill-index.json");

const YEAR = "2025";
const BIENNIUM = "2025-26";
const BULK_URL = "https://wslwebservices.leg.wa.gov/legislationservice.asmx/GetLegislationByYear";
const DOCUMENT_SEARCH_URL = "https://app.leg.wa.gov/bi/tld/documentsearchresults";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const KEYWORDS_CONCURRENCY = 5;
const BATCH_PAUSE_MS = 300;

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

function findHtmlDocumentUrl(html, billNumber) {
  const matches = [...String(html).matchAll(/<a[^>]+href="([^"]+)"[^>]*>/gi)];
  for (const [, href] of matches) {
    const url = href.replace(/&amp;/g, "&");
    if (/\.html?(\?|$)/i.test(url) && url.includes(billNumber)) {
      return url.startsWith("http") ? url : `https://app.leg.wa.gov${url}`;
    }
  }
  return null;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchBillText(billNumber) {
  const searchUrl = `${DOCUMENT_SEARCH_URL}?${new URLSearchParams({ biennium: BIENNIUM, documentType: "1", name: billNumber })}`;
  const searchRes = await fetch(searchUrl, { headers: { Accept: "text/html, */*" } });
  if (!searchRes.ok) return "";

  const searchHtml = await searchRes.text();
  const docUrl = findHtmlDocumentUrl(searchHtml, billNumber);
  if (!docUrl) return "";

  const docRes = await fetch(docUrl, { headers: { Accept: "text/html, */*" } });
  if (!docRes.ok) return "";

  return htmlToText(await docRes.text());
}

function parseLegislationInfo(block) {
  const billId = getTag(block, "BillId");
  const billNumber = getTag(block, "BillNumber");
  const originalAgency = getTag(block, "OriginalAgency");
  const shortDescription = getTag(block, "ShortDescription");
  const active = getTag(block, "Active");

  if (!billId || !billNumber) return null;
  if (active === "false") return null;

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
    keywords: [],
    source_url: `https://app.leg.wa.gov/billsummary?BillNumber=${billNumber}&Year=${YEAR}`,
    detail_api_path: `/api/wa-bill-detail?billNumber=${billNumber}&biennium=${BIENNIUM}`,
  };
}

async function generateKeywords(billText, apiKey) {
  if (!billText) return [];

  const prompt = `Here is the opening text of a Washington State bill:

${billText.slice(0, 500)}

List 10 plain-language keywords or short phrases a regular citizen might type into a search bar to find this bill. Focus on real-world impact and plain English — not legislative jargon.

Return ONLY a JSON array of strings. Example: ["keyword one", "keyword two"]`;

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim() || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string").slice(0, 10) : [];
  } catch (_) {
    return [];
  }
}

async function generateAllKeywords(records, apiKey, existingKeywords) {
  let completed = 0;
  let skipped = 0;
  for (let i = 0; i < records.length; i += KEYWORDS_CONCURRENCY) {
    const batch = records.slice(i, i + KEYWORDS_CONCURRENCY);
    await Promise.all(
      batch.map(async (record) => {
        if (existingKeywords.has(record.bill_number)) {
          record.keywords = existingKeywords.get(record.bill_number);
          skipped++;
          return;
        }
        const billText = await fetchBillText(record.bill_number).catch(() => "");
        record.keywords = await generateKeywords(billText, apiKey);
      })
    );
    completed += batch.length;
    process.stdout.write(`\r  Keywords: ${completed}/${records.length} (${skipped} reused)`);
    if (i + KEYWORDS_CONCURRENCY < records.length) {
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }
  process.stdout.write("\n");
}

async function loadExistingKeywords() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf8");
    const records = JSON.parse(raw);
    return new Map(
      records
        .filter((r) => Array.isArray(r.keywords) && r.keywords.length > 0)
        .map((r) => [r.bill_number, r.keywords])
    );
  } catch (_) {
    return new Map();
  }
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
  const apiKey = process.env.Anthropic_API_Key;
  if (!apiKey) {
    console.warn("Warning: Anthropic_API_Key not set — keywords will be empty arrays.");
  }

  console.log("Fetching 2025-26 session bills from WA Legislature...");

  const url = `${BULK_URL}?${new URLSearchParams({ year: YEAR })}`;

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

  if (apiKey) {
    const existingKeywords = await loadExistingKeywords();
    console.log(`Existing keywords loaded for ${existingKeywords.size} bills — will skip those.`);
    console.log(`Generating keywords for ${records.length - existingKeywords.size} bills (${KEYWORDS_CONCURRENCY} concurrent)...`);
    await generateAllKeywords(records, apiKey, existingKeywords);
    const withKeywords = records.filter((r) => r.keywords.length > 0).length;
    console.log(`Keywords populated for ${withKeywords}/${records.length} bills`);
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(records, null, 2), "utf8");

  console.log(`Wrote ${records.length} records → ${OUTPUT_PATH}`);

  const sample = records.find((r) => r.keywords.length > 0) || records[0];
  if (sample) {
    console.log("\nSample record:");
    console.log(JSON.stringify(sample, null, 2));
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
