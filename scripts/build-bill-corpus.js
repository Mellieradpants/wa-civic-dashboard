// Run with: node scripts/build-bill-corpus.js
// Fetches full bill text for all bills in data/wa/bill-index.json and writes
// data/wa/bill-corpus.json. Read-only relative to the index — never modifies it.
//
// Run from local or GitHub Actions only.
// wslwebservices.leg.wa.gov returns 403 from Render's IP — do not run on Render.
// app.leg.wa.gov (used by fetchBillTextData) is the correct fetch target.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH  = path.join(__dirname, "..", "data", "wa", "bill-index.json");
const CORPUS_PATH = path.join(__dirname, "..", "data", "wa", "bill-corpus.json");

const BATCH_SIZE     = 5;
const BATCH_DELAY_MS = 1000;
const LOG_INTERVAL   = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBill(record) {
  const { bill_number, session, title } = record;
  const fetchedAt = new Date().toISOString();
  try {
    const data = await fetchBillTextData(bill_number, session);
    return {
      bill_number,
      session,
      title,
      sections: data.sections,
      fetchedAt,
      error: null,
    };
  } catch (err) {
    return {
      bill_number,
      session,
      title,
      sections: [],
      text: "",
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  if (existsSync(CORPUS_PATH)) {
    console.error(
      "data/wa/bill-corpus.json already exists.\n" +
      "Delete it first if a fresh run is needed: rm data/wa/bill-corpus.json"
    );
    process.exit(1);
  }

  const bills = JSON.parse(await fs.readFile(INDEX_PATH, "utf8"));
  const total  = bills.length;

  console.log(`Starting corpus build — ${total} bills`);
  console.log(`Batch size: ${BATCH_SIZE} | Delay: ${BATCH_DELAY_MS}ms | Checkpoint every: ${LOG_INTERVAL} bills\n`);

  const results = [];
  let failed = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch    = bills.slice(i, i + BATCH_SIZE);
    const settled  = await Promise.allSettled(batch.map(fetchBill));

    for (const outcome of settled) {
      const entry = outcome.status === "fulfilled"
        ? outcome.value
        : {
            bill_number: batch[settled.indexOf(outcome)]?.bill_number ?? null,
            session:     batch[settled.indexOf(outcome)]?.session ?? null,
            title:       batch[settled.indexOf(outcome)]?.title ?? null,
            sections:    [],
            text:        "",
            fetchedAt:   new Date().toISOString(),
            error:       outcome.reason instanceof Error
                           ? outcome.reason.message
                           : String(outcome.reason),
          };
      if (entry.error) failed++;
      results.push(entry);
    }

    const fetched = results.length;
    const isCheckpoint = fetched % LOG_INTERVAL === 0 || fetched === total;

    if (isCheckpoint) {
      console.log(`[${fetched}/${total}] ${failed} failed so far`);
      await fs.writeFile(CORPUS_PATH, JSON.stringify(results), "utf8");
    }

    if (i + BATCH_SIZE < total) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  await fs.writeFile(CORPUS_PATH, JSON.stringify(results), "utf8");
  console.log(`\nDone. ${total} bills processed, ${failed} failed.`);
  console.log(`Output written to data/wa/bill-corpus.json`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message ?? err);
  process.exit(1);
});
