#!/usr/bin/env node
// Diagnostic-only script — reproduces scoreC6's duplicate-paragraph check from
// scripts/test-bills.js without the 80-char truncation, so the full duplicated
// text can be inspected. Not wired into any CI gate; run manually via
// workflow_dispatch against a local server.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BASE_URL = "http://localhost:3000";
const BIENNIUM = "2025-26";

const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const KNOWN_BOILERPLATE = TEST_BILLS_CONFIG.knownBoilerplate || [];

const STATIC_PARAGRAPHS = {
  _exact: new Set([
    "No obligation or change detected in this section.",
    "This section is repealed and no longer in effect.",
  ]),
  has(p) {
    return this._exact.has(p) || KNOWN_BOILERPLATE.some(prefix => p.startsWith(prefix));
  },
};

const BILLS = [5890, 2398, 1433, 1101, 1104, 1109];

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function closestBoilerplate(p) {
  let best = null;
  let bestScore = 0;
  for (const prefix of KNOWN_BOILERPLATE) {
    const len = Math.min(prefix.length, p.length);
    let common = 0;
    while (common < len && prefix[common] === p[common]) common++;
    if (common > bestScore) {
      bestScore = common;
      best = prefix;
    }
  }
  return best ? { prefix: best, commonChars: bestScore } : null;
}

async function diagnoseBill(billNumber) {
  let textData;
  try {
    textData = await getJSON(
      `${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: BIENNIUM })}`
    );
  } catch (err) {
    console.log(`BILL ${billNumber}: wa-bill-text fetch failed — ${err.message}`);
    return;
  }

  const sections = (textData?.sections || []).filter(s => s.text?.trim());
  if (!sections.length) {
    console.log(`BILL ${billNumber}: no sections found`);
    return;
  }

  console.log(`BILL ${billNumber}: ${sections.length} sections — ids: ${sections.map(s => s.id).join(", ")}`);
  const rawTextSeen = new Map();
  for (const sec of sections) {
    const norm = sec.text.replace(/\s+/g, " ").trim();
    if (rawTextSeen.has(norm)) {
      console.log(`BILL ${billNumber}: RAW SECTION TEXT DUPLICATE — section ${sec.id} has identical raw text to section ${rawTextSeen.get(norm)}`);
    } else {
      rawTextSeen.set(norm, sec.id);
    }
  }

  let combined = "";
  const paragraphOrigin = [];
  for (const sec of sections) {
    try {
      const r = await postJSON(`${BASE_URL}/api/plain-meaning`, { text: sec.text });
      if (r.plainMeaning) {
        combined += (combined ? "\n\n" : "") + r.plainMeaning;
        for (const para of r.plainMeaning.split("\n\n")) {
          paragraphOrigin.push({ sectionId: sec.id, para: para.trim() });
        }
      }
    } catch (err) {
      console.log(`BILL ${billNumber}: plain-meaning failed for section ${sec.id} — ${err.message}`);
    }
  }

  const paragraphs = paragraphOrigin.filter(po => po.para);
  const firstSeenAt = new Map();
  let dupCount = 0;
  for (const { sectionId, para: p } of paragraphs) {
    if (STATIC_PARAGRAPHS.has(p)) continue;
    if (firstSeenAt.has(p)) {
      dupCount++;
      console.log(`\n=== BILL ${billNumber}: DUPLICATE #${dupCount} ===`);
      console.log(`FIRST SEEN IN SECTION: ${firstSeenAt.get(p)} — REPEATED IN SECTION: ${sectionId}`);
      console.log(`LENGTH: ${p.length} chars`);
      console.log(`FULL TEXT:\n${p}`);
      const close = closestBoilerplate(p);
      console.log(
        close
          ? `CLOSEST KNOWN_BOILERPLATE PREFIX (${close.commonChars} matching leading chars): "${close.prefix}"`
          : `CLOSEST KNOWN_BOILERPLATE PREFIX: none share any leading chars`
      );
      continue;
    }
    firstSeenAt.set(p, sectionId);
  }
  if (!dupCount) console.log(`BILL ${billNumber}: no C6 duplication found`);
}

async function debugSection(billNumber, sectionId) {
  const textData = await getJSON(
    `${BASE_URL}/api/wa-bill-text?${new URLSearchParams({ billNumber, biennium: BIENNIUM })}`
  );
  const sec = (textData?.sections || []).find(s => s.id === sectionId);
  if (!sec) {
    console.log(`BILL ${billNumber} ${sectionId}: NOT FOUND`);
    return;
  }
  console.log(`\n##### BILL ${billNumber} ${sectionId} — RAW TEXT (${sec.text.length} chars) #####`);
  console.log(sec.text);

  const r = await postJSON(`${BASE_URL}/api/plain-meaning`, { text: sec.text, debug: true });
  console.log(`\n##### BILL ${billNumber} ${sectionId} — ${r.sentences.length} RENDERED UNIT(S) #####`);
  r.sentences.forEach((s, i) => {
    console.log(`\n--- unit ${i} — lens: ${s.lens} — status: ${s.status} ---`);
    console.log(`anchorText: ${s.anchorText}`);
    console.log(`sentence (contains \\n\\n: ${s.sentence?.includes("\n\n")}):\n${s.sentence}`);
    if (s.debug) console.log(`debug fields: ${JSON.stringify(s.debug)}`);
  });
}

(async () => {
  for (const b of BILLS) {
    await diagnoseBill(b);
  }
  await debugSection("1104", "section_6");
  await debugSection("1104", "section_10");
  await debugSection("5890", "section_1");
  await debugSection("5890", "section_2");
})();
