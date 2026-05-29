const TEXT_ENDPOINT = "/api/wa-bill-text";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

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

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${proto}://${host}`;
}

async function fetchBillText(req, billNumber, biennium) {
  const baseUrl = getBaseUrl(req);
  const url = `${baseUrl}${TEXT_ENDPOINT}?${new URLSearchParams({ billNumber, biennium }).toString()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Bill text fetch failed: HTTP ${response.status}`);
  return response.json();
}

async function generatePlainSummary(billText) {
  const apiKey = process.env.gemini_api_key;

  if (!apiKey) {
    throw new Error("gemini_api_key is not configured");
  }

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

  const response = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 300 },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
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

  try {
    const textData = await fetchBillText(req, billNumber, biennium);
    const sections = textData.sections || [];

    if (!sections.length) {
      return res.status(404).json({
        message: "No bill text sections found for this bill.",
        billNumber,
        biennium,
      });
    }

    const fullText = sections.map((s) => s.text || "").join("\n\n").slice(0, 16000);
    const summary = await generatePlainSummary(fullText);

    return res.status(200).json({
      billNumber,
      biennium,
      summary,
      sectionCount: sections.length,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Plain summary generation failed.",
      billNumber,
      biennium,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
