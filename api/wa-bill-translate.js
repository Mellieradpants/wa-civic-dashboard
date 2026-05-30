const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

const LANGUAGE_NAMES = {
  es: "Spanish",
  so: "Somali",
  vi: "Vietnamese",
  tl: "Tagalog",
};

async function getRedis() {
  try {
    const { Redis } = await import("@upstash/redis");
    return Redis.fromEnv();
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  const { text, language, billNumber, biennium } = req.body || {};

  if (!text || !language) {
    return res.status(400).json({ message: "Missing required fields: text, language" });
  }

  const languageName = LANGUAGE_NAMES[language];
  if (!languageName) {
    return res.status(400).json({
      message: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_NAMES).join(", ")}`,
    });
  }

  const apiKey = process.env.Anthropic_API_Key;
  if (!apiKey) {
    return res.status(500).json({ message: "Anthropic_API_Key is not configured" });
  }

  const cacheKey = billNumber && biennium
    ? `translate:${language}:${billNumber}:${biennium}`
    : null;

  const redis = await getRedis();

  if (redis && cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.status(200).json({ translatedText: cached, language, cached: true });
      }
    } catch (_) {}
  }

  const prompt = `Translate the following plain-language summary of a Washington State bill into ${languageName}. Keep the same plain, accessible tone — this is for everyday people, not legal professionals. Preserve the meaning exactly. Return only the translated text, nothing else.

${text}`;

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(500).json({
        message: `Anthropic API error ${response.status}`,
        detail: body.slice(0, 300),
      });
    }

    const data = await response.json();
    const translatedText = data.content?.[0]?.text?.trim() || "";

    if (redis && cacheKey && translatedText) {
      try {
        await redis.set(cacheKey, translatedText, { ex: 60 * 60 * 24 * 30 });
      } catch (_) {}
    }

    return res.status(200).json({ translatedText, language });
  } catch (error) {
    return res.status(500).json({
      message: "Translation failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
