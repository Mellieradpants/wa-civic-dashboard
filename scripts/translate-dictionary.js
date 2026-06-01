// Reads missing tokens from Redis, translates each verb and object into all
// 7 target languages via Google Translate REST API, and merges results into
// lib/action-dictionary.json without overwriting existing entries.
//
// Required env vars:
//   KV_REST_API_URL        — Upstash Redis URL
//   KV_REST_API_TOKEN      — Upstash Redis token
//   GOOGLE_TRANSLATE_API_KEY — Google Cloud Translate API key

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Redis } from "@upstash/redis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_PATH = path.join(__dirname, "..", "lib", "action-dictionary.json");
const LANGUAGES = ["es", "vi", "ru", "uk", "tl", "so", "ko"];

// Mirrors the same stripping used by pipeline.js logIfMissing and the renderer
// so dictionary keys stay consistent across write and lookup paths.
function stripTemporal(s) {
  return s
    ? s.replace(/\s+within\s+[\w\s]+(?:days?|months?|years?|hours?|weeks?)[^,;.]*/gi, "")
        .replace(/\s+no later than\s+[^;.]*/gi, "")
        .replace(/[,;\s]+$/, "")
        .trim() || s
    : s;
}

async function googleTranslate(text, targetLang, apiKey) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, target: targetLang, format: "text" }),
  });
  if (!res.ok) {
    throw new Error(`Google Translate ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.data.translations[0].translatedText;
}

async function translateTokens(tokens, label, existing, apiKey) {
  const results = { ...existing };
  for (const token of tokens) {
    if (results[token]) {
      console.log(`  ${label} "${token}" — already in dictionary, skipping`);
      continue;
    }
    console.log(`  Translating ${label}: "${token}"`);
    const translations = {};
    for (const lang of LANGUAGES) {
      try {
        translations[lang] = await googleTranslate(token, lang, apiKey);
      } catch (err) {
        console.warn(`    [warn] ${lang}: ${err.message}`);
      }
    }
    results[token] = translations;
  }
  return results;
}

async function main() {
  const { KV_REST_API_URL, KV_REST_API_TOKEN, GOOGLE_TRANSLATE_API_KEY } = process.env;

  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
    process.exit(1);
  }
  if (!GOOGLE_TRANSLATE_API_KEY) {
    console.error("Missing GOOGLE_TRANSLATE_API_KEY");
    process.exit(1);
  }

  const redis = new Redis({ url: KV_REST_API_URL, token: KV_REST_API_TOKEN });
  const entries = await redis.lrange("missing-tokens", 0, -1);
  console.log(`${entries.length} missing token entries in Redis`);

  // Parse entries: "timestamp | rawAction | verb | obj | billId"
  const verbSet = new Set();
  const objSet = new Set();

  for (const entry of entries) {
    const parts = String(entry).split(" | ");
    if (parts.length < 3) continue;
    const verb = parts[2]?.trim();
    const rawObj = parts[3]?.trim();
    const obj = rawObj ? stripTemporal(rawObj).toLowerCase() : null;
    if (verb) verbSet.add(verb);
    if (obj) objSet.add(obj);
  }

  console.log(`Unique verbs: ${verbSet.size}, unique objects: ${objSet.size}`);

  const dict = JSON.parse(readFileSync(DICT_PATH, "utf8"));

  console.log("\nVerbs:");
  dict.verbs = await translateTokens([...verbSet], "verb", dict.verbs || {}, GOOGLE_TRANSLATE_API_KEY);

  console.log("\nObjects:");
  dict.objects = await translateTokens([...objSet], "object", dict.objects || {}, GOOGLE_TRANSLATE_API_KEY);

  writeFileSync(DICT_PATH, JSON.stringify(dict, null, 2) + "\n", "utf8");
  console.log(`\nDone. Dictionary now has ${Object.keys(dict.verbs).length} verbs, ${Object.keys(dict.objects).length} objects.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
