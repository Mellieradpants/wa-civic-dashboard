import { renderISC } from "../lib/plain-meaning/renderer.js";

const SUPPORTED_LANGS = new Set(["es", "vi", "ru", "uk", "tl", "so", "ko"]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }

  const { units, lang } = body || {};

  if (!Array.isArray(units)) {
    return res.status(400).json({ message: "units must be an array of ISC units." });
  }

  if (!lang || !SUPPORTED_LANGS.has(lang)) {
    return res.status(400).json({
      message: `lang must be one of: ${[...SUPPORTED_LANGS].join(", ")}`,
    });
  }

  try {
    const { plainMeaning, sentences, sectionType, hasContent } = renderISC({ units }, { lang });
    return res.status(200).json({ plainMeaning, sentences, sectionType, hasContent });
  } catch (error) {
    return res.status(500).json({
      message: "Translation failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
