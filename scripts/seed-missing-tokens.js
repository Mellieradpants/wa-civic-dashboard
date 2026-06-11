// Loops through data/wa/bill-index.json and pushes verb+object pairs to the
// Redis missing-tokens list.
//
// Two sources of verbs:
//  1. LEGISLATIVE_VERBS — hardcoded base-form verbs that appear after
//     "shall/must/may" in WA bill text. These are the forms the pipeline's
//     tokenizeAction actually extracts, so they must be in the dictionary.
//  2. Legal title gerunds — extracted from each bill's legal_title
//     ("AN ACT Relating to providing X; creating Y") plus a de-gerunded
//     base-form attempt for each, since titles use gerunds but bill text uses
//     base forms.
//
// Already-translated verbs are skipped.
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

// Base-form verbs the pipeline extracts from "shall/must/may" obligation clauses
// in actual WA bill text. These are the keys the renderer looks up in the dictionary.
const LEGISLATIVE_VERBS = [
  "provide", "create", "establish", "require", "allow", "authorize", "modify",
  "review", "report", "certify", "approve", "adopt", "notify", "implement",
  "designate", "develop", "maintain", "conduct", "impose", "exempt", "fund",
  "define", "amend", "repeal", "transfer", "collect", "regulate", "determine",
  "ensure", "identify", "publish", "prepare", "distribute", "verify", "evaluate",
  "coordinate", "facilitate", "monitor", "assess", "inspect", "audit",
  "investigate", "recommend", "allocate", "calculate", "comply", "consult",
  "disclose", "enforce", "file", "grant", "issue", "operate", "perform",
  "protect", "replace", "request", "restore", "retain", "revoke", "support",
  "update", "expand", "reduce", "increase", "decrease", "administer", "apply",
  "assign", "manage", "respond", "test", "train", "award", "obtain", "process",
  "select", "permit", "prohibit", "restrict", "limit", "inform", "document",
  "record", "track", "appeal", "address", "include", "exclude", "extend",
  "terminate", "suspend", "renew", "complete", "produce", "promote", "protect",
  "purchase", "register", "remove", "report", "require", "review", "seek",
  "set", "show", "use", "withdraw", "accept", "access", "account", "act",
  "add", "adjust", "approve", "base", "begin", "bring", "build", "charge",
  "choose", "close", "consult", "continue", "control", "cover", "demonstrate",
  "describe", "design", "enter", "establish", "estimate", "follow", "give",
  "handle", "help", "hold", "include", "keep", "make", "meet", "notify",
  "offer", "open", "pay", "place", "plan", "post", "provide", "reach",
  "return", "serve", "sign", "start", "stop", "take", "treat", "work",
  "ask", "sell", "lower", "knowingly",
];

// Same temporal stripping as pipeline.js stripTemporalFromObj.
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

// Given a gerund form, return candidate base forms the pipeline might produce.
// "providing" → ["provid", "provide"]  (both tried; "provide" is the useful one)
// "allowing"  → ["allow", "allowe"]    ("allow" is the useful one)
// "certifying"→ ["certif", "certife", "certify"]  (via -ify rule)
function baseFormsOf(gerund) {
  if (!gerund.endsWith("ing")) return [gerund];
  const stem = gerund.slice(0, -3);
  const forms = new Set();
  forms.add(stem);             // "allow" from "allowing"
  forms.add(stem + "e");       // "provide" from "providing"
  if (stem.endsWith("if")) forms.add(stem + "y"); // "certify" from "certifying"
  if (stem.length >= 4 && stem.at(-1) === stem.at(-2)) {
    forms.add(stem.slice(0, -1)); // "submit" from "submitting"
  }
  return [...forms].filter(f => f.length >= 3);
}

const NON_VERB = new Set([
  "a", "an", "the", "of", "for", "in", "on", "at", "to", "by", "or", "and",
  "with", "from", "about", "into", "through", "during", "including", "until",
  "against", "between", "without", "after", "before", "above", "below", "if",
  "when", "unless", "as", "this", "that", "these", "those", "its", "his",
  "her", "their", "our", "all", "any", "each", "every", "other", "such", "no",
  "not", "only", "state", "new", "old", "long", "short", "public", "private",
  "local", "national", "certain", "various", "additional", "general", "special",
  "further", "eligible", "applicable",
]);

function legalTitlePhrases(legalTitle) {
  if (!legalTitle) return [];
  return legalTitle
    .replace(/^AN ACT\s+/i, "")
    .replace(/\.$/, "")
    .split(/;\s*/)
    .map(p => p.replace(/^Relating to\s+/i, "").trim())
    .filter(Boolean);
}

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
  const ts = new Date().toISOString();

  // Source 1: hardcoded legislative base-form verbs.
  // Uses "this requirement" as a generic object so the entry parses correctly.
  for (const verb of new Set(LEGISLATIVE_VERBS)) {
    if (dict.verbs?.[verb]) continue;
    const key = `${verb}|`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(`${ts} | ${verb} this requirement | ${verb} | this requirement | legislative_vocab`);
  }
  console.log(`Hardcoded legislative verbs not yet in dictionary: ${entries.length}`);

  // Source 2: gerunds from bill legal titles + de-gerunded base forms.
  let fromTitles = 0;
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

      // Push the gerund form itself
      const candidates = [verb];

      // Also push de-gerunded base form candidates so the pipeline's base-form
      // lookups have a match even when the legal title only has the gerund.
      if (verb.endsWith("ing")) {
        candidates.push(...baseFormsOf(verb));
      }

      for (const candidate of candidates) {
        if (dict.verbs?.[candidate]) continue;
        const key = `${candidate}|${obj ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(`${ts} | ${raw} | ${candidate} | ${obj ?? ""} | ${bill.bill_id_display}`);
        fromTitles++;
      }
    }
  }
  console.log(`From bill titles (gerunds + base forms): ${fromTitles}`);
  console.log(`Total entries to push: ${entries.length}`);

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
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
