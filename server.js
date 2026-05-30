import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

// ─── Load and register all API handlers ──────────────────────────────────────

const HANDLERS = [
  { path: "/api/health",                 file: "./api/health.js",                 methods: ["GET"] },
  { path: "/api/wa-bill-search",         file: "./api/wa-bill-search.js",         methods: ["GET"] },
  { path: "/api/wa-bill-detail",         file: "./api/wa-bill-detail.js",         methods: ["GET"] },
  { path: "/api/wa-bill-documents",      file: "./api/wa-bill-documents.js",      methods: ["GET"] },
  { path: "/api/wa-bill-text",           file: "./api/wa-bill-text.js",           methods: ["GET"] },
  { path: "/api/wa-bill-selection",      file: "./api/wa-bill-selection.js",      methods: ["GET"] },
  { path: "/api/wa-bill-plain-summary",  file: "./api/wa-bill-plain-summary.js",  methods: ["GET"] },
  { path: "/api/wa-bill-translate",      file: "./api/wa-bill-translate.js",      methods: ["POST"] },
  { path: "/api/analyze",               file: "./api/analyze.js",               methods: ["POST"] },
  { path: "/api/plain-meaning",          file: "./api/plain-meaning.js",          methods: ["POST"] },
  { path: "/api/openapi",               file: "./api/openapi.js",               methods: ["GET"] },
];

async function registerHandlers() {
  for (const { path, file, methods } of HANDLERS) {
    try {
      const mod = await import(file);
      const handler = mod.default;
      for (const method of methods) {
        app[method.toLowerCase()](path, handler);
      }
      // Always handle OPTIONS for CORS preflight
      app.options(path, (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", methods.join(", ") + ", OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.status(204).end();
      });
      console.log(`  ${methods.join("|")} ${path}`);
    } catch (err) {
      console.warn(`  WARN: could not load ${file} — ${err.message}`);
    }
  }
}

// ─── Root ─────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host;
  res.json({
    service: "WA Civic Dashboard API",
    status: "ok",
    spec: `${proto}://${host}/api/openapi`,
    endpoints: HANDLERS.map((h) => ({
      path: h.path,
      methods: h.methods,
    })),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

registerHandlers().then(() => {
  app.listen(PORT, () => {
    console.log(`\nWA Civic Dashboard API listening on port ${PORT}`);
    console.log(`Spec: http://localhost:${PORT}/api/openapi\n`);
  });
}).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
