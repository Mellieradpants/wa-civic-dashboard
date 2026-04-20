function inferContentType(content, sourceUrl) {
  const trimmed = (content || "").trim();
  const lowerUrl = (sourceUrl || "").toLowerCase();

  if (lowerUrl.endsWith(".xml") || lowerUrl.endsWith(".soap") || lowerUrl.endsWith(".wsdl")) {
    return "xml";
  }

  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<soap") || trimmed.startsWith("<")) {
    return "xml";
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }

  return "text";
}

async function resolveContent(body) {
  if (typeof body.content === "string" && body.content.trim()) {
    return {
      content: body.content,
      contentType: body.contentType || inferContentType(body.content, body.sourceUrl),
      sourceUrl: body.sourceUrl || null,
    };
  }

  if (typeof body.sourceUrl === "string" && body.sourceUrl.trim()) {
    const response = await fetch(body.sourceUrl, {
      headers: {
        Accept: "application/xml, text/xml, application/soap+xml, text/plain, application/json;q=0.8, */*;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`Source fetch failed (${response.status})`);
    }

    const content = await response.text();
    return {
      content,
      contentType: body.contentType || inferContentType(content, body.sourceUrl),
      sourceUrl: body.sourceUrl,
    };
  }

  throw new Error("No legislation content provided");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const analyzeBaseUrl = process.env.ANALYZE_API_BASE_URL || "https://anchored-flow-stack.onrender.com";
    const analyzeSecret = process.env.ANALYZE_SECRET;

    if (!analyzeSecret) {
      return res.status(500).json({ message: "ANALYZE_SECRET is not configured" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { content, contentType, sourceUrl } = await resolveContent(body);

    const upstreamResponse = await fetch(`${analyzeBaseUrl}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-analyze-secret": analyzeSecret,
      },
      body: JSON.stringify({
        content,
        content_type: contentType,
        options: {
          run_meaning: true,
          run_origin: true,
          run_verification: true,
        },
        source_url: sourceUrl,
      }),
    });

    const text = await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      return res.status(upstreamResponse.status).send(text);
    }

    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(text);
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Analysis proxy failed",
    });
  }
}
