import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const synonymMap = JSON.parse(
  readFileSync(path.join(process.cwd(), "lib", "synonymMap.json"), "utf8")
);

const LEGISLATION_SERVICE_BASE = "https://wslwebservices.leg.wa.gov/legislationservice.asmx";
const BILL_SUMMARY_BASE = "https://app.leg.wa.gov/billsummary";

const BILL_TYPE_RULES = [
  {
    abbreviation: "HB",
    recordType: "House Bill",
    chamber: "House",
    min: 1000,
    max: 3999,
    description: "Bills propose to amend, add, or repeal statutes.",
  },
  {
    abbreviation: "SB",
    recordType: "Senate Bill",
    chamber: "Senate",
    min: 5000,
    max: 7999,
    description: "Bills propose to amend, add, or repeal statutes.",
  },
  {
    abbreviation: "HJM",
    recordType: "House Joint Memorial",
    chamber: "House",
    min: 4000,
    max: 4199,
    description: "Memorials express the Legislature's concern, usually to the President and the U.S. Congress.",
  },
  {
    abbreviation: "SJM",
    recordType: "Senate Joint Memorial",
    chamber: "Senate",
    min: 8000,
    max: 8199,
    description: "Memorials express the Legislature's concern, usually to the President and the U.S. Congress.",
  },
  {
    abbreviation: "HJR",
    recordType: "House Joint Resolution",
    chamber: "House",
    min: 4200,
    max: 4399,
    description: "Joint resolutions propose to amend the state constitution.",
  },
  {
    abbreviation: "SJR",
    recordType: "Senate Joint Resolution",
    chamber: "Senate",
    min: 8200,
    max: 8399,
    description: "Joint resolutions propose to amend the state constitution.",
  },
  {
    abbreviation: "HCR",
    recordType: "House Concurrent Resolution",
    chamber: "House",
    min: 4400,
    max: 4599,
    description: "Concurrent resolutions relate to the internal operation of the Legislature.",
  },
  {
    abbreviation: "SCR",
    recordType: "Senate Concurrent Resolution",
    chamber: "Senate",
    min: 8400,
    max: 8599,
    description: "Concurrent resolutions relate to the internal operation of the Legislature.",
  },
  {
    abbreviation: "HR",
    recordType: "House Resolution",
    chamber: "House",
    min: 4600,
    max: 4999,
    description: "Resolutions are typically used to commemorate, congratulate, or adopt rules for one body only.",
  },
  {
    abbreviation: "SR",
    recordType: "Senate Resolution",
    chamber: "Senate",
    min: 8600,
    max: 8999,
    description: "Resolutions are typically used to commemorate, congratulate, or adopt rules for one body only.",
  },
  {
    abbreviation: "SGA",
    recordType: "Senate Gubernatorial Appointment",
    chamber: "Senate",
    min: 9000,
    max: 9999,
    description: "An appointment made by the Governor to fill an office or position; only the Senate confirms gubernatorial appointments.",
  },
];

function normalizeQuery(text) {
  return String(text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function extractBillNumber(text) {
  // Strip RCW/statute citations before matching so "RCW 70A.565.020" doesn't yield "565"
  const noStatute = String(text || "").replace(/\bRCW\s+[\d.A-Za-z]+/gi, "");
  const match = noStatute.match(/\b\d{3,4}\b/);
  return match ? match[0] : "";
}

function routeBillNumber(billNumber) {
  const number = Number(billNumber);
  const matchedRule = BILL_TYPE_RULES.find((rule) => number >= rule.min && number <= rule.max);

  if (matchedRule) {
    return {
      ...matchedRule,
      number,
      displayNumber: `${matchedRule.abbreviation} ${billNumber}`,
      routingSource: "Washington bill number assignment rules",
    };
  }

  return {
    abbreviation: "Bill",
    recordType: "Legislative record",
    chamber: "Unknown",
    number,
    displayNumber: `Bill ${billNumber}`,
    description: "Record type not identified by the configured Washington bill number assignment ranges.",
    routingSource: "Washington bill number assignment rules",
  };
}

function normalizeBiennium(value) {
  const text = String(value || "").trim();

  if (/^\d{4}-\d{2}$/.test(text)) return text;

  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    const startYear = year % 2 === 0 ? year - 1 : year;
    return `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const startYear = year % 2 === 0 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function buildBillSummaryUrl(billNumber, biennium) {
  const startYear = String(biennium || "").slice(0, 4);
  const params = new URLSearchParams({
    BillNumber: billNumber,
    Year: startYear || "2025",
  });
  return `${BILL_SUMMARY_BASE}?${params.toString()}`;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getTag(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

function getBlock(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1] : "";
}

function parseLegislation(xml) {
  const legislationBlock = getBlock(xml, "Legislation");
  const currentStatusBlock = getBlock(legislationBlock, "CurrentStatus");

  if (!legislationBlock) return null;

  return {
    shortDescription: getTag(legislationBlock, "ShortDescription"),
    longDescription: getTag(legislationBlock, "LongDescription"),
    legalTitle: getTag(legislationBlock, "LegalTitle"),
    sponsor: getTag(legislationBlock, "Sponsor"),
    introducedDate: getTag(legislationBlock, "IntroducedDate"),
    currentStatus: currentStatusBlock
      ? {
          historyLine: getTag(currentStatusBlock, "HistoryLine"),
          actionDate: getTag(currentStatusBlock, "ActionDate"),
          status: getTag(currentStatusBlock, "Status"),
        }
      : null,
  };
}

function scoreRecord(record, query) {
  const normalized = normalizeQuery(query);
  const lowered = String(query || "").trim().toLowerCase();
  const terms = lowered.split(/\s+/).filter(Boolean);

  const fields = [
    record.bill_id_display,
    record.bill_id_normalized,
    record.bill_number,
    record.chamber,
    record.record_type,
    record.title,
    record.session,
    record.status,
    record.plain_meaning_summary,
    record.summary,
    ...(record.keywords || []),
    ...(record.aliases || []),
  ].filter(Boolean);

  const normalizedFields = fields.map((field) => normalizeQuery(field));
  const loweredFields = fields.map((field) => String(field).toLowerCase());

  let score = 0;

  if (normalized && normalizedFields.some((field) => field === normalized)) score += 100;
  if (normalized && normalizedFields.some((field) => field.startsWith(normalized))) score += 40;
  if (normalized && normalizedFields.some((field) => field.includes(normalized))) score += 20;

  score += terms.filter((term) =>
    loweredFields.some((field) => field.includes(term))
  ).length * 10;

  return score;
}

function scoreRecordMulti(record, terms) {
  return Math.max(...terms.map((t) => scoreRecord(record, t)));
}

async function loadBillIndex() {
  const filePath = path.join(process.cwd(), "data", "wa", "bill-index.json");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function mapRecord(record) {
  const billNumber = record.bill_number || extractBillNumber(record.bill_id_display || "");
  const route = billNumber ? routeBillNumber(billNumber) : null;
  const display = record.bill_id_display || route?.displayNumber || record.bill_number || null;

  return {
    bill_id_display: display,
    bill_id_normalized: record.bill_id_normalized || normalizeQuery(display || ""),
    bill_number: record.bill_number || billNumber || null,
    abbreviation: record.abbreviation || route?.abbreviation || null,
    record_type: record.record_type || route?.recordType || null,
    chamber: record.chamber || route?.chamber || null,
    title: record.title || record.bill_id_display || "Untitled",
    session: record.session || null,
    status: record.status || null,
    summary: record.plain_meaning_summary || record.summary || null,
    source_url: record.source_url || null,
    detail_json_path: record.detail_json_path || null,
    detail_api_path: record.detail_api_path || null,
    source: record.source || "local_index",
    routing: route,
    sponsor: record.sponsor || null,
    introducedDate: record.introducedDate || null,
    historyLine: record.historyLine || null,
    committee: record.committee || null,
    legal_title: record.legal_title || null,
  };
}

async function lookupOfficialBillByNumber(billNumber, biennium) {
  if (!billNumber) return null;

  const route = routeBillNumber(billNumber);
  const url = `${LEGISLATION_SERVICE_BASE}/GetLegislation?${new URLSearchParams({
    biennium,
    billNumber,
  }).toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "text/xml, application/xml, */*",
    },
  });

  if (!response.ok) return null;

  const xml = await response.text();
  const parsed = parseLegislation(xml);
  if (!parsed) return null;

  const display = route.displayNumber;
  const title = parsed.shortDescription || parsed.legalTitle || parsed.longDescription || "Untitled bill";
  const summary = parsed.legalTitle || parsed.longDescription || parsed.shortDescription || null;
  const status = parsed.currentStatus?.status || parsed.currentStatus?.historyLine || null;

  return {
    bill_id_display: display,
    bill_id_normalized: normalizeQuery(display),
    bill_number: billNumber,
    abbreviation: route.abbreviation,
    record_type: route.recordType,
    chamber: route.chamber,
    title,
    session: biennium,
    status,
    summary,
    source_url: buildBillSummaryUrl(billNumber, biennium),
    detail_api_path: `/api/wa-bill-detail?billNumber=${encodeURIComponent(billNumber)}&biennium=${encodeURIComponent(biennium)}`,
    source: "official_lookup",
    routing: route,
    sponsor: parsed.sponsor || null,
    introducedDate: parsed.introducedDate || null,
  };
}

function applyParentTerms(query) {
  const s = String(query || "").toLowerCase();
  // Sort by phrase length descending so "motor vehicle" matches before "vehicle"
  const phrases = Object.keys(synonymMap.parentTerms).sort((a, b) => b.length - a.length);
  const plain = [];
  for (const phrase of phrases) {
    if (s.includes(phrase)) plain.push(synonymMap.parentTerms[phrase]);
  }
  return plain;
}

function getRcwTitleFilter(words) {
  const titles = new Set();
  for (const word of words) {
    const matches = synonymMap.termMap[String(word).toLowerCase()];
    if (matches) {
      for (const t of matches) titles.add(t.replace(/^Title\s+/i, ""));
    }
  }
  return titles;
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((record) => {
    const key = normalizeQuery(`${record.session || ""}${record.bill_id_display || record.bill_number || ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const query = String(req.query.q || "").trim();
    const session = String(req.query.session || req.query.biennium || req.query.year || "").trim();
    const biennium = normalizeBiennium(session);

    if (!query) {
      return res.status(200).json({
        query,
        session: session || null,
        biennium,
        results: [],
      });
    }

    const billIndex = await loadBillIndex();

    const parentWords = applyParentTerms(query);
    const allTerms = [query, ...parentWords].filter(Boolean);
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const rcwTitleFilter = getRcwTitleFilter([...queryWords, ...parentWords]);

    const localResults = billIndex
      .map((record) => {
        const score = scoreRecordMulti(record, allTerms);
        const titleMatch =
          rcwTitleFilter.size > 0 &&
          (record.rcw_titles || []).some((t) => rcwTitleFilter.has(t));
        return { record, score: titleMatch && score === 0 ? 1 : score, titleMatch };
      })
      .filter((entry) => entry.score > 0)
      .filter((entry) => {
        if (!session) return true;
        return String(entry.record.session || "").includes(session) || String(entry.record.session || "").includes(biennium);
      })
      .sort((left, right) =>
        right.score - left.score ||
        String(left.record.bill_id_display || "").localeCompare(
          String(right.record.bill_id_display || "")
        )
      )
      .slice(0, 10)
      .map(({ record }) => mapRecord(record));

    const billNumber = extractBillNumber(query);
    const officialResult = billNumber ? await lookupOfficialBillByNumber(billNumber, biennium) : null;
    const routing = billNumber ? routeBillNumber(billNumber) : null;

    const results = dedupeResults([
      ...(officialResult ? [officialResult] : []),
      ...localResults,
    ]).slice(0, 10);

    return res.status(200).json({
      query,
      session: session || null,
      biennium,
      routing,
      searchMode: billNumber ? "official_bill_number_plus_local_index" : "local_index_keyword",
      indexSize: billIndex.length,
      rawSample: billIndex[0] || null,
      rcwExpansion: rcwTitleFilter.size > 0 ? [...rcwTitleFilter].map((t) => `Title ${t}`) : [],
      results,
      note: billNumber
        ? "Bill-number searches use Washington bill number assignment rules before live official lookup. Keyword searches currently use the local index until a broader official index adapter is added."
        : "Keyword searches currently use the local index until a broader official index adapter is added.",
    });
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Washington bill search failed",
    });
  }
}
