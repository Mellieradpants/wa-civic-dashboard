const log = [];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({ count: log.length, entries: log });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  const { verb, object: obj, raw, bill_id, lang } = body || {};

  const entry = {
    timestamp: new Date().toISOString(),
    verb: verb || null,
    object: obj || null,
    raw: raw || null,
    bill_id: bill_id || null,
    lang: lang || null,
  };

  log.push(entry);
  console.log("[missing-token]", JSON.stringify(entry));

  return res.status(200).json({ recorded: true });
}
