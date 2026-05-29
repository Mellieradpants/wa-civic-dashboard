const DOCUMENT_SEARCH_URL = "https://app.leg.wa.gov/bi/tld/documentsearchresults";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

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
  const year = new Date().getUTCFullYear();
  const startYear = year % 2 === 0 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
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

async function fetchBillTextDirect(billNumber, biennium) {
  const searchUrl = `${DOCUMENT_SEARCH_URL}?${new URLSearchParams({ biennium, documentType: "1", name: billNumber })}`;
  const searchRes = await fetch(searchUrl, { headers: { Accept: "text/html, */*" } });
  if (!searchRes.ok) throw new Error(`Document search failed: HTTP ${searchRes.status}`);

  const searchHtml = await searchRes.text();
  const docUrl = findHtmlDocumentUrl(searchHtml, billNumber);
  if (!docUrl) throw new Error("No HTML bill document found in document search results");

  const docRes = await fetch(docUrl, { headers: { Accept: "text/html, */*" } });
  if (!docRes.ok) throw new Error(`Bill document fetch failed: HTTP ${docRes.status}`);

  return htmlToText(await docRes.text()).slice(0, 16000);
}

async function generatePlainSummary(billText, apiKey) {
  const prompt = `Here is the text of a Washington State bill. Write one paragraph (3–5 sentences) explaining what this bill does in plain English.

Guidelines:
- Write for a 10th-grade reading level
- Answer the question "what does this mean for me?" for an everyday person
- Be direct and concrete — state what the bill does, not what it "seeks to" or "aims to" do
- Avoid legal jargon and bureaucratic phrasing
- Do not start with "This bill"
- Only use "may" or "could" if the bill itself is genuinely conditional

Respond with only the paragraph. No labels, no introduction.

Bill text:
${billText}`;

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || "";
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
      expectedQuery: "/api/wa-bill-plain-summary?billNumber=6361&biennium=2025-26",
    });
  }

  const apiKey = process.env.Anthropic_API_Key;
  if (!apiKey) {
    return res.status(500).json({ message: "Anthropic_API_Key is not configured" });
  }

  try {
    const billText = await fetchBillTextDirect(billNumber, biennium);
    const summary = await generatePlainSummary(billText, apiKey);
    return res.status(200).json({ billNumber, biennium, summary });
  } catch (error) {
    return res.status(500).json({
      message: "Plain summary generation failed.",
      billNumber,
      biennium,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
