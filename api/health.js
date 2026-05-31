import fs from "node:fs/promises";
import path from "node:path";

const WA_LEG_PING = "https://wslwebservices.leg.wa.gov/legislationservice.asmx?WSDL";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "localhost";
  const serviceUrl = `${proto}://${host}`;

  const checks = {};

  // Bill index loaded
  try {
    const indexPath = path.join(process.cwd(), "data", "wa", "bill-index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const index = JSON.parse(raw);
    checks.billIndex = { status: "ok", count: Array.isArray(index) ? index.length : 0 };
  } catch (err) {
    checks.billIndex = { status: "error", error: err.message };
  }

  // WA Legislature API reachability
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(WA_LEG_PING, { signal: controller.signal });
    clearTimeout(timeout);
    checks.waLegApi = { status: resp.ok ? "ok" : "degraded", httpStatus: resp.status };
  } catch (err) {
    checks.waLegApi = { status: "unreachable", error: err.message };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  return res.status(200).json({
    status: allOk ? "ok" : "degraded",
    serviceUrl,
    plainMeaningEndpoint: `${serviceUrl}/api/plain-meaning`,
    checks,
  });
}
