const LEGISLATION_SERVICE_BASE = "https://wslwebservices.leg.wa.gov/legislationservice.asmx";
const BILL_SUMMARY_BASE = "https://app.leg.wa.gov/billsummary";

function stripPrefix(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^(HB|SB|SHB|SSB|EHB|ESB|2SHB|2SSB|3SHB|3SSB)\s*/i, "")
    .replace(/[^0-9]/g, "");
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

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
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
    request: getTag(legislationBlock, "Request"),
    introducedDate: getTag(legislationBlock, "IntroducedDate"),
    sponsor: getTag(legislationBlock, "Sponsor"),
    primeSponsorID: getTag(legislationBlock, "PrimeSponsorID"),
    stateFiscalNote: getTag(legislationBlock, "StateFiscalNote"),
    localFiscalNote: getTag(legislationBlock, "LocalFiscalNote"),
    appropriations: getTag(legislationBlock, "Appropriations"),
    currentStatus: currentStatusBlock
      ? {
          billId: getTag(currentStatusBlock, "BillId"),
          historyLine: getTag(currentStatusBlock, "HistoryLine"),
          actionDate: getTag(currentStatusBlock, "ActionDate"),
          status: getTag(currentStatusBlock, "Status"),
          amendedByOppositeBody: getTag(currentStatusBlock, "AmendedByOppositeBody"),
          partialVeto: getTag(currentStatusBlock, "PartialVeto"),
          veto: getTag(currentStatusBlock, "Veto"),
          amendmentsExist: getTag(currentStatusBlock, "AmendmentsExist"),
        }
      : null,
  };
}

function buildBillSummaryUrl(billNumber, biennium) {
  const startYear = String(biennium || "").slice(0, 4);
  const params = new URLSearchParams({
    BillNumber: billNumber,
    Year: startYear || "2025",
  });
  return `${BILL_SUMMARY_BASE}?${params.toString()}`;
}

async function fetchBillSummaryPage(billNumber, biennium) {
  const url = buildBillSummaryUrl(billNumber, biennium);
  const res = await fetch(url, { headers: { Accept: "text/html, */*" } });
  if (!res.ok) throw new Error(`Bill summary page fetch failed: HTTP ${res.status}`);
  return { html: await res.text(), url };
}

function parseBillSummaryHtml(html) {
  const result = { sponsor: null, introducedDate: null, historyLine: null };

  const sponsorMatch = html.match(/Sponsors?:[\s\S]{0,500}?<a[^>]*>([^<]+)<\/a>/i);
  if (sponsorMatch) {
    result.sponsor = decodeHtml(sponsorMatch[1].trim());
  }

  const historySection = html.match(/[Bb]ill\s+[Hh]istory([\s\S]{0,8000})/);
  if (historySection) {
    const block = historySection[1];
    const dateRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/g;
    const positions = [];
    let m;
    while ((m = dateRe.exec(block)) !== null) {
      positions.push({ index: m.index, date: `${m[1]} ${m[2]}` });
    }
    const entries = [];
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].index + positions[i].date.length;
      const end = i + 1 < positions.length ? positions[i + 1].index : Math.min(start + 400, block.length);
      const action = decodeHtml(
        block.slice(start, end).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      );
      if (action.length > 3) entries.push({ date: positions[i].date, action });
    }
    if (entries.length > 0) {
      result.introducedDate = entries[0].date;
      const last = entries[entries.length - 1];
      result.historyLine = `${last.date} — ${last.action}`;
    }
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const rawBill = req.query.billNumber || req.query.bill || req.query.q || "";
  const billNumber = stripPrefix(rawBill);
  const biennium = normalizeBiennium(req.query.biennium || req.query.session || req.query.year);

  if (!billNumber) {
    return res.status(400).json({
      message: "Missing bill number.",
      expectedQuery: "/api/wa-bill-detail?billNumber=1234&biennium=2025-26",
    });
  }

  const officialXmlUrl = `${LEGISLATION_SERVICE_BASE}/GetLegislation?${new URLSearchParams({
    biennium,
    billNumber,
  }).toString()}`;

  const officialSummaryUrl = buildBillSummaryUrl(billNumber, biennium);

  try {
    const response = await fetch(officialXmlUrl, {
      headers: { Accept: "text/xml, application/xml, */*" },
    });
    const xml = await response.text();
    if (!response.ok) throw new Error(`XML service returned HTTP ${response.status}`);

    const parsed = parseLegislation(xml);

    if (!parsed) {
      return res.status(404).json({
        message: "No legislation detail found for this bill and biennium.",
        billNumber,
        biennium,
        sourceUrl: officialXmlUrl,
        officialSummaryUrl,
      });
    }

    return res.status(200).json({
      sourceSystem: "Washington State Legislature Legislative Web Services",
      billNumber,
      biennium,
      displayNumber: `HB/SB ${billNumber}`,
      title: parsed.shortDescription || parsed.legalTitle || parsed.longDescription || "Untitled bill",
      summary: parsed.longDescription || parsed.shortDescription || parsed.legalTitle || null,
      legalTitle: parsed.legalTitle,
      request: parsed.request,
      introducedDate: parsed.introducedDate,
      sponsor: parsed.sponsor,
      primeSponsorID: parsed.primeSponsorID,
      status: parsed.currentStatus?.status || parsed.currentStatus?.historyLine || null,
      currentStatus: parsed.currentStatus,
      fiscalFlags: {
        stateFiscalNote: parsed.stateFiscalNote,
        localFiscalNote: parsed.localFiscalNote,
        appropriations: parsed.appropriations,
      },
      source_url: officialSummaryUrl,
      service_xml_url: officialXmlUrl,
      raw_xml_excerpt: xml.slice(0, 1200),
      note: "This endpoint fetches official bill metadata. Full bill text/document fetching will be added in the next adapter step.",
    });
  } catch (xmlError) {
    try {
      const { html } = await fetchBillSummaryPage(billNumber, biennium);
      const scraped = parseBillSummaryHtml(html);
      return res.status(200).json({
        sourceSystem: "Washington State Legislature bill summary page (HTML fallback)",
        billNumber,
        biennium,
        displayNumber: `HB/SB ${billNumber}`,
        title: null,
        summary: null,
        legalTitle: null,
        request: null,
        introducedDate: scraped.introducedDate,
        sponsor: scraped.sponsor,
        primeSponsorID: null,
        status: scraped.historyLine,
        currentStatus: scraped.historyLine ? {
          billId: null,
          historyLine: scraped.historyLine,
          actionDate: null,
          status: scraped.historyLine,
          amendedByOppositeBody: null,
          partialVeto: null,
          veto: null,
          amendmentsExist: null,
        } : null,
        fiscalFlags: { stateFiscalNote: null, localFiscalNote: null, appropriations: null },
        source_url: officialSummaryUrl,
        service_xml_url: officialXmlUrl,
      });
    } catch (scrapeError) {
      return res.status(500).json({
        message: "Washington bill detail lookup failed.",
        billNumber,
        biennium,
        sourceUrl: officialXmlUrl,
        officialSummaryUrl,
        error: xmlError instanceof Error ? xmlError.message : String(xmlError),
        scrapeError: scrapeError instanceof Error ? scrapeError.message : String(scrapeError),
      });
    }
  }
}
