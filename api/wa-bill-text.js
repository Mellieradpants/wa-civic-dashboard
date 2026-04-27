const DOCUMENTS_ENDPOINT = "/api/wa-bill-documents";

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

function selectBestTextDocument(documents) {
  const htmlDocument = documents.find((doc) => String(doc.file_type || "").toLowerCase() === "html");
  if (htmlDocument) return htmlDocument;

  const htmUrlDocument = documents.find((doc) => /\.html?$|\.html?\?/i.test(String(doc.url || "")));
  if (htmUrlDocument) return htmUrlDocument;

  return null;
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

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${proto}://${host}`;
}

async function loadDocuments(req, billNumber, biennium) {
  const baseUrl = getBaseUrl(req);
  const url = `${baseUrl}${DOCUMENTS_ENDPOINT}?${new URLSearchParams({ billNumber, biennium }).toString()}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Document lookup failed with HTTP ${response.status}`);
  }

  return response.json();
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
    const documentData = await loadDocuments(req, billNumber, biennium);
    const documents = documentData.documents || [];
    const textDocument = selectBestTextDocument(documents);

    if (!textDocument) {
      return res.status(404).json({
        message: "No HTML bill document was found for text extraction.",
        billNumber,
        biennium,
        documentLookup: documentData.documentSearchUrl,
        availableDocuments: documents,
      });
    }

    const documentResponse = await fetch(textDocument.url, {
      headers: {
        Accept: "text/html, text/plain, */*",
      },
    });

    const rawDocument = await documentResponse.text();

    if (!documentResponse.ok) {
      return res.status(documentResponse.status).json({
        message: "Official bill text document request failed.",
        billNumber,
        biennium,
        sourceDocument: textDocument,
        serviceStatus: documentResponse.status,
        serviceBody: rawDocument.slice(0, 800),
      });
    }

    const text = cleanHtmlToText(rawDocument);
    const sections = splitIntoSections(text);

    return res.status(200).json({
      sourceSystem: "Washington State Legislature official bill document",
      billNumber,
      biennium,
      sourceDocument: textDocument,
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
