// Loops through data/wa/bill-index.json, extracts candidate verb+object pairs
// from bill titles and legal titles using the same first-space tokenization as
// the pipeline (tokenizeAction), and pushes them to the Redis missing-tokens
// list so translate-dictionary.js can cover the full legislative vocabulary.
//
// Run once before translate-dictionary.js. Already-translated verbs are skipped.
//
// Required env vars:
//   KV_REST_API_URL   — Upstash Redis URL
//   KV_REST_API_TOKEN — Upstash Redis token

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Redis } from "@upstash/redis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BILL_INDEX_PATH = path.join(__dirname, "..", "data", "wa", "bill-index.json");
const DICT_PATH = path.join(__dirname, "..", "lib", "action-dictionary.json");

// Same temporal stripping used by pipeline.js stripTemporalFromObj and
// translate-dictionary.js stripTemporal so object keys are consistent.
function stripTemporal(s) {
  return s
    ? s.replace(/\s+within\s+[\w\s]+(?:days?|months?|years?|hours?|weeks?)[^,;.]*/gi, "")
        .replace(/\s+no later than\s+[^;.]*/gi, "")
        .replace(/[,;\s]+$/, "")
        .trim() || s
    : s;
}

// Same first-space tokenization as pipeline.js tokenizeAction.
function tokenize(phrase) {
  const s = phrase.replace(/^[,\s]+/, "").replace(/[.;,\s]+$/, "").trim();
  if (s.length < 3) return null;
  const i = s.indexOf(" ");
  const verb = i < 0 ? s.toLowerCase() : s.slice(0, i).toLowerCase();
  const obj = i < 0 ? null : stripTemporal(s.slice(i + 1).trim()) || null;
  return { verb, obj, raw: s };
}

// Articles, prepositions, and other words that can never be a verb starter
// in a legislative action phrase. These come from noun-phrase bill titles.
const NON_VERB = new Set([
  "a", "an", "the", "of", "for", "in", "on", "at", "to", "by", "or", "and",
  "with", "from", "about", "into", "through", "during", "including", "until",
  "against", "between", "without", "after", "before", "above", "below", "if",
  "when", "unless", "as", "this", "that", "these", "those", "its", "his",
  "her", "their", "our", "all", "any", "each", "every", "other", "such", "no",
  "not", "only", "state", "new", "old", "long", "short", "public", "private",
  "local", "national", "certain", "various", "additional", "general", "special",
  "further", "certain", "eligible", "applicable",
]);

// Split a legal_title into clause-level phrases.
// "AN ACT Relating to expanding X; providing for Y; amending Z"
// → ["expanding X", "providing for Y", "amending Z"]
function legalTitlePhrases(legalTitle) {
  if (!legalTitle) return [];
  return legalTitle
    .replace(/^AN ACT\s+/i, "")
    .replace(/\.$/, "")
    .split(/;\s*/)
    .map(p => p.replace(/^Relating to\s+/i, "").trim())
    .filter(Boolean);
}

// Split a ShortDescription title into phrases.
// "Submit reports; adjust compensation" → ["Submit reports", "adjust compensation"]
function titlePhrases(title) {
  if (!title) return [];
  return title.split(/[;/]/).map(p => p.trim()).filter(Boolean);
}

async function main() {
  const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
    process.exit(1);
  }

  const billIndex = JSON.parse(readFileSync(BILL_INDEX_PATH, "utf8"));
  const dict = JSON.parse(readFileSync(DICT_PATH, "utf8"));
  const redis = new Redis({ url: KV_REST_API_URL, token: KV_REST_API_TOKEN });

  const seen = new Set();
  const entries = [];

  for (const bill of billIndex) {
    const phrases = [
      ...legalTitlePhrases(bill.legal_title),
      ...titlePhrases(bill.title),
    ];

    for (const phrase of phrases) {
      const token = tokenize(phrase);
      if (!token) continue;
      const { verb, obj, raw } = token;

      if (NON_VERB.has(verb)) continue;

      // Skip verbs already covered by the dictionary — translate-dictionary
      // would skip them anyway, but this keeps the entry count honest.
      if (dict.verbs?.[verb]) continue;

      const key = `${verb}|${obj ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const entry = `${new Date().toISOString()} | ${raw} | ${verb} | ${obj ?? ""} | ${bill.bill_id_display}`;
      entries.push(entry);
    }
  }

  console.log(`Extracted ${entries.length} unique pairs (verbs not yet in dictionary)`);

  const BATCH = 50;
  let pushed = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await redis.lpush("missing-tokens", ...batch);
    pushed += batch.length;
    if (pushed % 500 === 0 || pushed === entries.length) {
      console.log(`  ${pushed}/${entries.length} pushed`);
    }
  }

  console.log(`\nDone. ${pushed} entries in Redis missing-tokens list.`);

  console.log("\nSample verbs to be translated:");
  const verbSample = [...new Set(entries.map(e => e.split(" | ")[2]))].slice(0, 20);
  console.log(" ", verbSample.join(", "));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
