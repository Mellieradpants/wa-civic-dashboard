const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const apiKey = process.env.Anthropic_API_Key;
  if (!apiKey) {
    return res.status(500).json({ message: "Anthropic_API_Key is not configured" });
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
