export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(200).json({
      status: "degraded",
      anthropicKey: "missing",
      message: "ANTHROPIC_API_KEY is not configured — plain summary will not work.",
    });
  }

  try {
    const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      }),
    });

    if (response.ok) {
      return res.status(200).json({
        status: "ok",
        anthropicKey: "valid",
        message: "Anthropic API key is configured and working.",
      });
    }

    const body = await response.text();
    return res.status(200).json({
      status: "degraded",
      anthropicKey: "invalid",
      httpStatus: response.status,
      message: "Anthropic API key is set but the API rejected it.",
      detail: body.slice(0, 200),
    });
  } catch (error) {
    return res.status(200).json({
      status: "error",
      anthropicKey: "unknown",
      message: "Could not reach Anthropic API.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
