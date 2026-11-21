import { MAX_SOURCE_BYTES } from "../lib/legislation/evidence.js";
import { analyzeCapturedBill } from "../lib/legislation/washington.js";

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

// The Washington Legislature's own end-of-document marker — every bill file
// at lawfilesext.leg.wa.gov ends with a centered bold "--- END ---" banner.
// Not bill content, and not something this module generates, but tag
// stripping keeps the words, so it flows downstream into rendered plain
// meaning unless removed here. Tolerant of the observed real shape: 3+
// hyphens, optional whitespace, "END" (case-insensitive), optional
// whitespace, 3+ hyphens, and an optional trailing period (the exact shape
// seen in HB 1111's rendered output: "...act. --- END ---."). Anchored to
// the END of the text only — the marker is a document terminator, so it is
// always last; a mid-document match must never be touched, since removing
// text from anywhere but the very end would shift the character offsets of
// everything before it and could break the L1 lineage invariant (slicing
// the source at a recorded offset must still reproduce the recorded text).
const END_MARKER_RE = /\s*-{3,}\s*END\s*-{3,}\s*\.?\s*$/i;

export function stripEndMarker(text) {
  return String(text || "").replace(END_MARKER_RE, "");
}

const STRUCTURAL_BREAK_RE = /<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi;
const STRUCK_TEXT_RE = /\(\([\s\S]*?\)\)/g;
const HTML_SECTION_HEADING_RE = /(?:NEW SECTION\.\s*)?Sec\.\s+(\d+)\.?/gi;
const TEXT_SECTION_HEADING_RE = /(?:^|\n)\s*(?:NEW SECTION\.\s*)?Sec\.\s+(\d+)\.?/gi;

function findSectionStarts(str, headingRe) {
  const starts = [];
  for (const m of str.matchAll(headingRe)) {
    starts.push({ index: m.index, sectionNumber: m[1] });
  }
  return starts;
}

function nearestSectionNumber(starts, offset) {
  let current = null;
  for (const s of starts) {
    if (s.index <= offset) current = s;
    else break;
  }
  return current ? current.sectionNumber : null;
}

// Struck-text and structural-break deletions happen before sec.text exists,
// so they're tracked relative to the raw document / pre-strike text and
// joined onto sections by nearest preceding section number — not by a
// sec.text position, which none of these deletions ever had.
function buildPreSourceLog(sections, rawHtml, preStruckText) {
  const htmlStarts = findSectionStarts(rawHtml, HTML_SECTION_HEADING_RE);
  const textStarts = findSectionStarts(preStruckText, TEXT_SECTION_HEADING_RE);
  const bySectionNumber = new Map();
  const preamble = [];

  const record = (sectionNumber, entry) => {
    if (sectionNumber == null) {
      preamble.push(entry);
      return;
    }
    if (!bySectionNumber.has(sectionNumber)) bySectionNumber.set(sectionNumber, []);
    bySectionNumber.get(sectionNumber).push(entry);
  };

  for (const m of rawHtml.matchAll(STRUCTURAL_BREAK_RE)) {
    record(nearestSectionNumber(htmlStarts, m.index), {
      type: "structural_break",
      removed: m[0],
      location: `raw HTML offset ${m.index}`,
    });
  }

  for (const m of preStruckText.matchAll(STRUCK_TEXT_RE)) {
    const sectionNumber = nearestSectionNumber(textStarts, m.index);
    record(sectionNumber, {
      type: "struck_text",
      removed: m[0],
      location: sectionNumber
        ? `Sec. ${sectionNumber} (pre-strip offset ${m.index})`
        : `before first section (pre-strip offset ${m.index})`,
    });
  }

  if (sections.length === 1 && sections[0].sectionNumber == null) {
    sections[0].preSourceLog = [...preamble, ...[...bySectionNumber.values()].flat()];
    return [];
  }

  for (const sec of sections) {
    sec.preSourceLog = (sec.sectionNumber && bySectionNumber.get(sec.sectionNumber)) || [];
  }

  return preamble;
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
  const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(12000), headers: { Accept: "text/html, */*" } });
  if (!searchRes.ok) throw new Error(`Document search failed: HTTP ${searchRes.status}`);

  const searchHtml = await searchRes.text();
  const docUrl = findHtmlDocumentUrl(searchHtml, billNumber);
  if (!docUrl) throw new Error("No HTML bill document found in document search results");

  return fetchWashingtonDocument(docUrl);
}

export async function fetchWashingtonDocument(docUrl) {
  const url = new URL(docUrl);
  if (url.protocol !== "https:" || !["app.leg.wa.gov", "lawfilesext.leg.wa.gov"].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error("Expected an HTTPS Washington Legislature document URL.");
  }
  const docRes = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "error", headers: { Accept: "text/html, text/plain, */*" } });
  if (!docRes.ok) throw new Error(`Bill document fetch failed: HTTP ${docRes.status}`);

  const contentType = docRes.headers.get("content-type") || "";
  if (!/^(?:text\/html|text\/plain)\b/i.test(contentType)) {
    throw new Error(`Expected HTML document but got content-type: ${contentType} (url: ${docUrl})`);
  }

  const encoding = /charset\s*=\s*["\x27]?([^;\s"\x27]+)/i.exec(contentType)?.[1] || "utf-8";
  const reader = docRes.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("Washington document exceeds the 4 MiB intake limit.");
    }
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks, length);
  const html = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
  return { html, sourceUrl: url.href, format: /^text\/html\b/i.test(contentType) ? "html" : "text", encoding };
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

export async function fetchBillTextData(billNumber, biennium, { documentUrl, beforeUrl, contextUrls = [], includeAnalysis = false, autoRetrieve = true } = {}) {
  const captured = documentUrl ? await fetchWashingtonDocument(documentUrl) : await fetchBillHtml(billNumber, biennium);
  const { html: rawDocument, sourceUrl } = captured;
  const preStruckText = cleanHtmlToText(rawDocument);
  const text = stripEndMarker(
    preStruckText
      .replace(/\(\([\s\S]*?\)\)/g, "")
      .replace(/ {2,}/g, " ")
      .trim()
  );
  const sections = splitIntoSections(text);
  const preSourceLog = buildPreSourceLog(sections, rawDocument, preStruckText);
  const analysis = includeAnalysis ? await analyzeCapturedBill(captured, { billNumber, biennium, beforeUrl, contextUrls, autoRetrieve, fetchDocument: fetchWashingtonDocument }) : null;
  return {
    billNumber,
    biennium,
    ...(analysis ? { analysis } : {}),
    sourceDocument: { url: sourceUrl, file_type: "html" },
    sections,
    text,
    preSourceLog,
  };
}

function readerView(analysis) {
  const { architecture, documents, meaning, plainMeaning, sectionTypes, lookups } = analysis;
  return {
    architecture,
    documents: documents.map(({ input, structure }) => ({
      input: { id: input.id, issues: input.issues, url: input.url },
      structure: { status: structure.status, issue: structure.issue },
    })),
    meaning: {
      afterId: meaning.afterId,
      descriptions: meaning.descriptions,
      lenses: meaning.lenses.map(({ lens, findings }) => ({
        lens, findings: findings.filter(finding => finding.status === "supported"),
      })),
    },
    plainMeaning, sectionTypes, lookups,
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
    const contextUrls = [].concat(req.query.contextUrl || []).slice(0, 6);
    const data = await fetchBillTextData(billNumber, biennium, {
      documentUrl: req.query.documentUrl, beforeUrl: req.query.beforeUrl, contextUrls, includeAnalysis: true, autoRetrieve: req.query.retrieve !== "false",
    });
    const { text, analysis, ...response } = data;
    response.analysis = req.query.view === "reader" ? readerView(analysis) : analysis;
    return res.status(200).json({ ...response,
      sourceSystem: "Washington State Legislature official bill document",
      textCharacterCount: text.length, sectionCount: data.sections.length,
      textPreview: text.slice(0, 1200),
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
