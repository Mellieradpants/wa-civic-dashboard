import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MISSING_TOKENS_FILE = path.join(__dirname, "..", "lib", "missing-tokens.txt");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const content = await readFile(MISSING_TOKENS_FILE, "utf8");
    const lines = content.split("\n").filter(Boolean);
    return res.status(200).json({ count: lines.length, entries: lines });
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(200).json({ count: 0, entries: [] });
    }
    return res.status(500).json({ message: "Could not read missing tokens log." });
  }
}
