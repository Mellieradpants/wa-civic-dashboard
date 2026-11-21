import { analyzeLegislation } from "../lib/legislation/analyze.js";
import { renderISC } from "../lib/plain-meaning/renderer.js";

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

  const { text, units, debug, documents, afterId, beforeId, lenses, alignment } = body || {};

  if (units === undefined) {
    if (!documents && typeof text !== "string") return res.status(400).json({ message: "Provide captured documents or a text string." });
    try {
      const result = await analyzeLegislation({ documents: documents ?? [{ id: "input", format: "text", source: text }], afterId, beforeId, lenses, alignment });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  }
  if (!Array.isArray(units) || documents !== undefined || text !== undefined) {
    return res.status(400).json({ message: "Provide a preprocessed units array by itself." });
  }
  try {
    const iscOutput = { units };
    const { plainMeaning, sentences, sectionType, hasContent, emptyReason } = renderISC(iscOutput, { debug: debug === true });

    return res.status(200).json({
      plainMeaning,
      sentences,
      sectionType,
      hasContent,
      emptyReason,
      units: iscOutput.units || [],
      lineage: iscOutput.lineage?.section ?? null,
      pipeline: {
        inputSource: "isc_units",
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
