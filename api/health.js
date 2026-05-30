const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "localhost";
  const serviceUrl = `${proto}://${host}`;

  const apiKey = process.env.gemini_api_key;

  if (!apiKey) {
    return res.status(200).json({
      status: "degraded",
      geminiKey: "missing",
      serviceUrl,
      plainMeaningEndpoint: `${serviceUrl}/api/plain-meaning`,
      message: "gemini_api_key is not configured — section translation will not work. Plain meaning is deterministic and always available.",
    });
  }

  try {
    const response = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    });

    if (response.ok) {
      return res.status(200).json({
        status: "ok",
        geminiKey: "valid",
        serviceUrl,
        plainMeaningEndpoint: `${serviceUrl}/api/plain-meaning`,
        message: "gemini_api_key is configured and working.",
      });
    }

    const body = await response.text();
    return res.status(200).json({
      status: "degraded",
      geminiKey: "invalid",
      httpStatus: response.status,
      serviceUrl,
      plainMeaningEndpoint: `${serviceUrl}/api/plain-meaning`,
      message: "gemini_api_key is set but the API rejected it.",
      detail: body.slice(0, 200),
    });
  } catch (error) {
    return res.status(200).json({
      status: "error",
      geminiKey: "unknown",
      serviceUrl,
      plainMeaningEndpoint: `${serviceUrl}/api/plain-meaning`,
      message: "Could not reach Gemini API.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

