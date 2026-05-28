const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

async function resolveContent(body) {
  if (typeof body.content === "string" && body.content.trim()) {
    return body.content;
  }

  if (typeof body.sourceUrl === "string" && body.sourceUrl.trim()) {
    const response = await fetch(body.sourceUrl, {
      headers: {
        Accept: "text/plain, text/html, application/xml, */*",
      },
    });
    if (!response.ok) throw new Error(`Source fetch failed (${response.status})`);
    return response.text();
  }

  throw new Error("No content provided");
}

async function translateToPlainLanguage(sectionText, apiKey) {
  const prompt = `Here is a section of a Washington State bill. Write one short paragraph in plain English explaining what this section does.

Guidelines:
- Write for a 10th-grade reading level
- State what the section does directly — no hedging, no "seeks to"
- Avoid legal jargon
- Do not start with "This section"

Respond with only the paragraph.

Section text:
${sectionText}`;

  const response = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const apiKey = process.env.gemini_api_key;
  if (!apiKey) {
    return res.status(500).json({ message: "GEMINI_API_KEY is not configured" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const content = await resolveContent(body);
    const translation = await translateToPlainLanguage(content, apiKey);

    return res.status(200).json({ translation });
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Analysis failed",
    });
  }
}
