import { runPipeline } from "../lib/plain-meaning/pipeline.js";
import { renderISC } from "../lib/plain-meaning/renderer.js";

const MAX_TEXT_LENGTH = 50_000;

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

  const { text, units, debug } = body || {};

  if (!text && !units) {
    return res.status(400).json({
      message: "Provide text (raw string) or units (pre-processed ISC array).",
      schema: {
        text: "string — bill or policy text; runs the full 10-layer pipeline",
        units:
          "array — pre-processed ISC output from TCS; skips pipeline, goes straight to renderer",
      },
      example: {
        text: "The department shall submit a report within thirty days of each audit.",
      },
    });
  }

  if (units !== undefined && !Array.isArray(units)) {
    return res.status(400).json({ message: "units must be an array." });
  }

  if (text !== undefined && (typeof text !== "string" || !text.trim())) {
    return res.status(400).json({ message: "text must be a non-empty string." });
  }

  if (text && text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({
      message: `text must not exceed ${MAX_TEXT_LENGTH.toLocaleString()} characters.`,
    });
  }

  try {
    let iscOutput;

    if (units) {
      // Primary path: pre-processed ISC units from the TCS Python pipeline.
      // Caller has already run the 10-layer pipeline; we go straight to the renderer.
      iscOutput = { units };
    } else {
      // Fallback only: raw text triggers the full JS pipeline internally.
      // Prefer posting ISC units from TCS for richer, higher-fidelity output.
      iscOutput = runPipeline(text.trim());
    }

    const { plainMeaning, sentences, sectionType, hasContent, emptyReason } = renderISC(iscOutput, { debug: debug === true });

    return res.status(200).json({
      plainMeaning,
      sentences,
      sectionType,
      hasContent,
      emptyReason,
      units: iscOutput.units || [],
      pipeline: {
        inputSource: units ? "isc_units" : "raw_text",
        unitCount: (iscOutput.units || units || []).length,
        sentenceCount: sentences.length,
        ...(iscOutput.inputLength !== undefined && {
          inputLength: iscOutput.inputLength,
          extractedSentences: iscOutput.sentenceCount,
        }),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Plain meaning generation failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
