import fs from "node:fs/promises";
import path from "node:path";

function normalizeQuery(text) {
  return String(text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function scoreRecord(record, query) {
  const normalized = normalizeQuery(query);
  const lowered = String(query || "").trim().toLowerCase();
  const terms = lowered.split(/\s+/).filter(Boolean);

  const fields = [
    record.bill_id_display,
    record.bill_id_normalized,
    record.bill_number,
    record.title,
    record.session,
    record.status,
    ...(record.aliases || []),
  ].filter(Boolean);

  const normalizedFields = fields.map((field) => normalizeQuery(field));
  const loweredFields = fields.map((field) => String(field).toLowerCase());

  let score = 0;

  if (normalized && normalizedFields.some((field) => field === normalized)) score += 100;
  if (normalized && normalizedFields.some((field) => field.startsWith(normalized))) score += 40;
  if (normalized && normalizedFields.some((field) => field.includes(normalized))) score += 20;

  score += terms.filter((term) =>
    loweredFields.some((field) => field.includes(term))
  ).length * 10;

  return score;
}

async function loadBillIndex() {
  const filePath = path.join(process.cwd(), "data", "wa", "bill-index.json");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const query = String(req.query.q || "").trim();
    const session = String(req.query.session || "").trim();

    if (!query) {
      return res.status(200).json({
        query,
        session: session || null,
        results: [],
      });
    }

    const billIndex = await loadBillIndex();

    const results = billIndex
      .map((record) => ({
        record,
        score: scoreRecord(record, query),
      }))
      .filter((entry) => entry.score > 0)
      .filter((entry) => {
        if (!session) return true;
        return String(entry.record.session || "").includes(session);
      })
      .sort((left, right) =>
        right.score - left.score ||
        String(left.record.bill_id_display || "").localeCompare(
          String(right.record.bill_id_display || "")
        )
      )
      .slice(0, 10)
      .map(({ record }) => ({
        bill_id_display: record.bill_id_display || record.bill_number || null,
        bill_id_normalized: record.bill_id_normalized || normalizeQuery(record.bill_id_display || record.bill_number || ""),
        bill_number: record.bill_number || null,
        title: record.title || "Untitled",
        session: record.session || null,
        status: record.status || null,
        summary: record.plain_meaning_summary || record.summary || null,
        source_url: record.source_url || null,
        detail_json_path: record.detail_json_path || null,
      }));

    return res.status(200).json({
      query,
      session: session || null,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Washington bill search failed",
    });
  }
}
