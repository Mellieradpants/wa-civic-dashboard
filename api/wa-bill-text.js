const DOCUMENT_SEARCH_BASE = "https://app.leg.wa.gov/bi/tld/documentsearchresults";

function extractBillNumber(text) {
  const match = String(text || "").match(/\b\d{3,4}\b/);
  return match ? match[0] : "";
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
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function cleanHtmlToText(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
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

async function fetchBillHtml(billNumber, biennium) {
  const searchUrl = `${DOCUMENT_SEARCH_BASE}?${new URLSearchParams({ biennium, documentType: "1", name: billNumber })}`;
  const searchRes = await fetch(searchUrl, { headers: { Accept: "text/html, */*" } });
  if (!searchRes.ok) throw new Error(`Document search failed: HTTP ${searchRes.status}`);

  const searchHtml = await searchRes.text();
  const docUrl = findHtmlDocumentUrl(searchHtml, billNumber);
  if (!docUrl) throw new Error("No HTML bill document found in document search results");

  const docRes = await fetch(docUrl, { headers: { Accept: "text/html, text/plain, */*" } });
  if (!docRes.ok) throw new Error(`Bill document fetch failed: HTTP ${docRes.status}`);

  return { html: await docRes.text(), sourceUrl: docUrl };
}

function splitIntoSections(text) {
  const sectionPattern = /(?:^|\n)\s*(NEW SECTION\.\s*)?Sec\.\s+\d+\.?[\s\S]*?(?=(?:\n\s*(?:NEW SECTION\.\s*)?Sec\.\s+\d+\.?\s)|$)/gi;
  const sections = [];
  let match;

  while ((match = sectionPattern.exec(text)) !== null) {
    const sectionText = match[0].trim();
    const numberMatch = sectionText.match(/Sec\.\s+(\d+)/i);
    const isNewSection = /NEW SECTION\./i.test(sectionText);

    if (sectionText.length > 20) {
      sections.push({
        id: `section_${numberMatch ? numberMatch[1] : sections.length + 1}`,
        sectionNumber: numberMatch ? numberMatch[1] : null,
        isNewSection,
        text: sectionText,
        characterCount: sectionText.length,
      });
    }
  }

  if (!sections.length && text.trim()) {
    sections.push({
      id: "section_1",
      sectionNumber: null,
      isNewSection: false,
      text: text.trim(),
      characterCount: text.trim().length,
    });
  }

  return sections;
}

export async function fetchBillTextData(billNumber, biennium) {
  const { html: rawDocument, sourceUrl } = await fetchBillHtml(billNumber, biennium);
  const text = cleanHtmlToText(rawDocument)
    .replace(/\(\([\s\S]*?\)\)/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return {
    billNumber,
    biennium,
    sourceDocument: { url: sourceUrl, file_type: "html" },
    sections: splitIntoSections(text),
    text,
  };
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
      expectedQuery: "/api/wa-bill-text?billNumber=6361&biennium=2025-26",
    });
  }

  try {
    const { html: rawDocument, sourceUrl } = await fetchBillHtml(billNumber, biennium);
    const text = cleanHtmlToText(rawDocument)
      .replace(/\(\([\s\S]*?\)\)/g, "")
      .replace(/ {2,}/g, " ")
      .trim();
    const sections = splitIntoSections(text);

    return res.status(200).json({
      sourceSystem: "Washington State Legislature official bill document",
      billNumber,
      biennium,
      sourceDocument: { url: sourceUrl, file_type: "html" },
      textCharacterCount: text.length,
      sectionCount: sections.length,
      sections,
      textPreview: text.slice(0, 1200),
      note: "This endpoint extracts source text and rough sections only. Structural node parsing and plain meaning are later steps.",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Washington bill text extraction failed.",
      billNumber,
      biennium,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
