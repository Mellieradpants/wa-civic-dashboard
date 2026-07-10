import fs from "node:fs/promises";
import path from "node:path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const indexPath = path.join(process.cwd(), "data", "wa", "bill-index.json");
    const indexRaw = await fs.readFile(indexPath, "utf8");
    const index = JSON.parse(indexRaw);
    const totalDistinctBills = new Set(index.map((b) => b.bill_number)).size;

    const resultsPath = path.join(process.cwd(), "data", "wa", "test-results.json");
    const resultsRaw = await fs.readFile(resultsPath, "utf8");
    const results = JSON.parse(resultsRaw);
    const testedBills = results.cumulativeStats?.testedBillNumbers?.length ?? 0;

    return res.status(200).json({ totalDistinctBills, testedBills });
  } catch (err) {
    return res.status(500).json({
      message: "Testing stats unavailable.",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
