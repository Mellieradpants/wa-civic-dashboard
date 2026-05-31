import express from "express";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
      // CORS preflight
      app.options(path, (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", methods.join(", ") + ", OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.status(204).end();
      });
      // Catch-all: any method not registered above returns JSON 405
      app.all(path, (req, res) => {
        res.setHeader("Allow", [...methods, "OPTIONS"].join(", "));
        res.status(405).json({ message: "Method not allowed" });
      });
      console.log(`  ${methods.join("|")} ${path}`);
    } catch (err) {
      console.warn(`  WARN: could not load ${file} — ${err.message}`);
    }
  }
}

// ─── Static pages and browser-importable lib modules ─────────────────────────

// Serve /lib so browser ES modules (e.g. import from '/lib/wa-adapter/index.js') resolve
app.use("/lib", express.static(path.join(__dirname, "lib")));

// Serve the three dashboard HTML pages by name; root stays as the JSON API index
for (const page of ["index.html", "legislation.html", "voting.html"]) {
  app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, page)));
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
