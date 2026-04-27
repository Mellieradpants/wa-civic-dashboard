const DOCUMENT_SEARCH_BASE = "https://app.leg.wa.gov/bi/tld/documentsearchresults";

const BILL_TYPE_RULES = [
  { abbreviation: "HB", recordType: "House Bill", chamber: "House", min: 1000, max: 3999 },
  { abbreviation: "SB", recordType: "Senate Bill", chamber: "Senate", min: 5000, max: 7999 },
  { abbreviation: "HJM", recordType: "House Joint Memorial", chamber: "House", min: 4000, max: 4199 },
  { abbreviation: "SJM", recordType: "Senate Joint Memorial", chamber: "Senate", min: 8000, max: 8199 },
  { abbreviation: "HJR", recordType: "House Joint Resolution", chamber: "House", min: 4200, max: 4399 },
  { abbreviation: "SJR", recordType: "Senate Joint Resolution", chamber: "Senate", min: 8200, max: 8399 },
  { abbreviation: "HCR", recordType: "House Concurrent Resolution", chamber: "House", min: 4400, max: 4599 },
  { abbreviation: "SCR", recordType: "Senate Concurrent Resolution", chamber: "Senate", min: 8400, max: 8599 },
  { abbreviation: "HR", recordType: "House Resolution", chamber: "House", min: 4600, max: 4999 },
  { abbreviation: "SR", recordType: "Senate Resolution", chamber: "Senate", min: 8600, max: 8999 },
  { abbreviation: "SGA", recordType: "Senate Gubernatorial Appointment", chamber: "Senate", min: 9000, max: 9999 },
];

function extractBillNumber(text) {
  const match = String(text || "").match(/\b\d{3,4}\b/);
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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "));
}

function absoluteUrl(href) {
  if (!href) return null;
  try {
    return new URL(decodeHtml(href), "https://app.leg.wa.gov").toString();
  } catch {
    return null;
  }
}

function inferDocumentDescription(text, href) {
  const haystack = `${text || ""} ${href || ""}`.toLowerCase();
  if (haystack.includes("original bill")) return "Original Bill";
  if (haystack.includes("substitute")) return "Substitute Bill";
  if (haystack.includes("engrossed")) return "Engrossed Bill";
  if (haystack.includes("amendment")) return "Amendment";
  if (haystack.includes("fiscal note")) return "Fiscal Note";
  if (haystack.includes("bill report")) return "Bill Report";
  return text || "Document";
}

function parseDocumentLinks(html, billNumber) {
  const links = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = decodeHtml(match[1]);
    const label = stripTags(match[2]);
    const url = absoluteUrl(href);

    if (!url) continue;
    if (!/documents\/billdocs/i.test(url)) continue;
    if (!url.includes(billNumber)) continue;

    const contextStart = Math.max(0, match.index - 600);
    const contextEnd = Math.min(html.length, anchorRegex.lastIndex + 600);
    const context = stripTags(html.slice(contextStart, contextEnd));

    links.push({
      title: label || `Bill document ${billNumber}`,
      description: inferDocumentDescription(context, href),
      url,
      file_type: url.toLowerCase().includes(".pdf") ? "pdf" : "document",
      source_context: context.slice(0, 500),
    });
  }

  const seen = new Set();
  return links.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function buildDocumentSearchUrl(billNumber, biennium) {
  const params = new URLSearchParams({
    biennium,
    documentType: "1",
    name: billNumber,
  });
  return `${DOCUMENT_SEARCH_BASE}?${params.toString()}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  const rawBill = req.query.billNumber || req.query.bill || req.query.q || "";
  const billNumber = extractBillNumber(rawBill);
  const biennium = normalizeBiennium(req.query.biennium || req.query.session || req.query.year);

  if (!billNumber) {
    return res.status(400).json({
      message: "Missing bill number.",
      expectedQuery: "/api/wa-bill-documents?billNumber=6361&biennium=2025-26",
    });
  }

  const routing = routeBillNumber(billNumber);
  const documentSearchUrl = buildDocumentSearchUrl(billNumber, biennium);

  try {
    const response = await fetch(documentSearchUrl, {
      headers: {
        Accept: "text/html, application/xhtml+xml, */*",
      },
    });

    const html = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Washington document search request failed.",
        billNumber,
        biennium,
        routing,
        documentSearchUrl,
        serviceStatus: response.status,
        serviceBody: html.slice(0, 800),
      });
    }

    const documents = parseDocumentLinks(html, billNumber);
    const originalBill = documents.find((doc) => /original bill/i.test(doc.description)) || documents[0] || null;

    return res.status(200).json({
      sourceSystem: "Washington State Legislature document search",
      billNumber,
      biennium,
      routing,
      documentSearchUrl,
      status: documents.length ? "found" : "not_found",
      originalBill,
      documents,
      note: documents.length
        ? "Document links are parsed from the official Washington Legislature document search page. Full text extraction is a later step."
        : "No bill document links were found in the official document search page response.",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Washington bill document lookup failed.",
      billNumber,
      biennium,
      routing,
      documentSearchUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
