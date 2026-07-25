#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Discovery sweep only: counts four candidate categories of sentences that
// carry requirement words (shall/must/may) without imposing a duty --
// defining phrases, phrases pointing outside the sentence, preamble
// ("legislature finds") sections, and passive constructions naming the
// acting party at the end in a "by" phrase -- plus a separate count of
// candidate forfeiture/seizure signal words. Raw output only -- no design,
// no fixes, no pipeline changes. Same 212-bill sample as prior
// discovery/validation rounds, for comparability.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(__dirname, "../tmp-scan-nonduty-categories-results.txt");

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const excludedNumbers = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);
const pool = [...new Set(
  BILL_INDEX.map(b => Number(b.bill_number))
    .filter(n => !excludedNumbers.has(n))
    .filter(n => !(n >= 4000 && n <= 4999))
    .filter(n => !(n >= 8000 && n <= 8999))
)].sort((a, b) => a - b);

const step = Math.max(1, Math.floor(pool.length / SAMPLE_SIZE));
const batch = [];
for (let i = 0; i < pool.length; i += step) batch.push(pool[i]);

function splitSentences(text) {
  return text
    .split(/(?<=[.!?;])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

const singleLine = (s) => s.replace(/\s+/g, " ").trim();

// ─── Round 2 baseline: the 39 sentences FIRST_SIDE_NOT_A_DUTY blocked ──────
// (Round 2 recorded 39 distinct suppressions; the task text says "40" --
// this script cross-checks against the 39 actually on record.)
const ROUND2_BASELINE = JSON.parse(String.raw`[{"bill": 1000, "section": "section_1", "sentence": "A departure from the standards in RCW 9.94A.589 (1) and (2) governing whether sentences are to be served consecutively or concurrently is an exceptional sentence subject to the limitations in this section, and may be appealed by the offender or the state as set forth in RCW 9.94A.585 (2) through (6)."}, {"bill": 1100, "section": "section_2", "sentence": "The tax is in addition to other taxes authorized by law and must be collected from those persons who are taxable by the state under chapters 82.08 and 82.12 RCW upon the occurrence of any taxable event within the city or county."}, {"bill": 1156, "section": "section_1", "sentence": "This subsection does not apply to higher education undergraduate and graduate student employees and shall be administered consistent with the requirements of the federal internal revenue code."}, {"bill": 1201, "section": "section_1", "sentence": "The legislature further finds that partnerships with nongovernmental organizations support emergency planning and preparedness and may be used to support identification and operation of coshelters."}, {"bill": 1323, "section": "section_2", "sentence": "(c) It is a class C felony if a person is a leader or organizer of the people engaging in obstructing highways and must pay a monetary penalty of at least $5,000, which may not be reduced to an amount less than $1,000."}, {"bill": 1378, "section": "section_7", "sentence": "(6) The department is not authorized to, and may not, supervise any offender sentenced to a term of community custody or any probationer unless the offender or probationer is one for whom supervision is required under this section or RCW 9.94A.5011 ."}, {"bill": 1400, "section": "section_1", "sentence": "The event, \"chief for a day,\" occurs on one day, annually or every other year and may occur on the grounds and in the facilities of the commission."}, {"bill": 1400, "section": "section_7", "sentence": "RCW 81.60.010 and 2001 c 72 s 1 are each amended to read as follows: The criminal justice training commission shall have the power to and may in its discretion commission railroad police officers at the request of any railroad corporation and may revoke any commission at its pleasure."}, {"bill": 1423, "section": "section_3", "sentence": "(11) Notwithstanding any other provision of law, all photographs, microphotographs, electronic images, or audio recordings, or any other personally identifying data prepared under this section are for the exclusive use of authorized city or county employees, as specified in RCW 46.63.030 (1)(d), in the discharge of duties under this section and are not open to the public and may not be used in a court in a pending action or proceeding unless the action or proceeding relates to a violation under this section."}, {"bill": 1468, "section": "section_10", "sentence": "Refunds of interest to the federal treasury required under the cash management improvement act fall under RCW 43.88.180 and shall not require appropriation."}, {"bill": 1534, "section": "section_11", "sentence": "(5) After 30 days following removal from the directory, the vapor products containing nicotine of a manufacturer identified in the notice of removal and intended for retail sale in this state or to a consumer in this state are subject to seizure, in accordance with RCW 82.25.095 , from distributors and retailers, forfeiture from distributors and retailers, and destruction or disposal, and may not be purchased or sold for retail sale in this state or to a consumer in this state."}, {"bill": 1534, "section": "section_12", "sentence": "(4) After 60 days following publication of the directory, vapor products containing nicotine not listed in the directory and intended for retail sale in this state or to a consumer in this state are subject to seizure, forfeiture, and destruction or disposal, and may not be purchased or sold for retail sale in this state or to a consumer in this state except as provided in subsections (2) and (3) of this section."}, {"bill": 1534, "section": "section_13", "sentence": "(4) Vapor products containing nicotine offered for sale in violation of sections 7 through 17 of this act are considered contraband and may be seized and disposed of or destroyed by an enforcement officer of the board."}, {"bill": 1623, "section": "section_1", "sentence": "Tips and service charges paid to an employee are in addition to, and may not count towards, the employee's hourly minimum wage."}, {"bill": 1714, "section": "section_10", "sentence": "(2) All interest and earnings collected on program funds belong to the program and must be deposited to the program's credit in the proper program account."}, {"bill": 1818, "section": "section_5", "sentence": "(6) It is a violation of this chapter, and may be restrained by injunctive action and found illegal as provided in this chapter, to sell, transfer, or lease any lot or tract that is on a binding site plan that has not been approved and recorded or does not conform to the requirements of the binding site plan."}, {"bill": 1818, "section": "section_9", "sentence": "The final plat must be processed administratively pursuant to RCW 58.17.140 (4) and may not be required to provide notice pursuant to RCW 36.70B.110 and may not require a public hearing."}, {"bill": 1818, "section": "section_27", "sentence": "The city, town, or county shall give notice as provided in RCW 58.17.080 and shall conduct a public hearing on the application for a vacation if required by local ordinance and may approve or deny the application for vacation of the subdivision based on determining whether the public use and interest would be served by the vacation of the subdivision."}, {"bill": 1946, "section": "section_1", "sentence": "These individuals may not be elected officials and may not have any fiduciary obligation to a health facility or other health agency, and may not have a material financial interest in the rendering of health services; and (iii) Other community stakeholders."}, {"bill": 1946, "section": "section_3", "sentence": "These individuals may not be elected officials, and may not have any fiduciary obligation to a health facility or other health agency, and may not have a material financial interest in the rendering of health services; and (iii) Other community stakeholders."}, {"bill": 1981, "section": "section_2", "sentence": "(2) The tax rate is three percent of the selling price of the renewable energy facility and must be assessed on the seller."}, {"bill": 2014, "section": "section_1", "sentence": "(10) \"Crime-related prohibition\" means an order of a court prohibiting conduct that directly relates to the circumstances of the crime for which the offender has been convicted, and shall not be construed to mean orders directing an offender affirmatively to participate in rehabilitative programs or to otherwise perform affirmative conduct."}, {"bill": 2112, "section": "section_5", "sentence": "(1) This chapter does not apply to a bona fide news or public interest broadcast, website video, report, or event and may not be construed to affect the rights of a news-gathering organization."}, {"bill": 5074, "section": "section_1", "sentence": "(12) \"Fixed or established place of business\" for the purpose of this chapter means any permanent warehouse, building, or structure, at which necessary and appropriate equipment and fixtures are maintained for properly handling those agricultural products generally dealt in, and at which supplies of the agricultural products being usually transported are stored, offered for sale, sold, delivered, and generally dealt with in quantities reasonably adequate for and usually carried for the requirements of such a business, and that is recognized as a permanent business at such place, and carried on as such in good faith and not for the purpose of evading this chapter, and where specifically designated personnel are available to handle transactions concerning those agricultural products generally dealt in, which personnel are available during designated and appropriate hours to that business, and shall not mean a residence, barn, garage, tent, temporary stand or other temporary quarters, any railway car, or permanent quarters occupied pursuant to any temporary arrangement."}, {"bill": 5085, "section": "section_403", "sentence": "(2) The value of the ratio obtained is the annual adjustment to the original retirement allowance and must be applied beginning with the July payment."}, {"bill": 5118, "section": "section_1", "sentence": "(f) A limited license issued under this subsection is valid for two years and may be renewed three times by the commission upon application for renewal by the nominating entity for a total of eight years ."}, {"bill": 5129, "section": "section_20", "sentence": "(10)(a) A unit owners association that willfully violates this section is liable to the unit owner for actual damages, and shall pay a civil penalty to the unit owner in an amount not to exceed $1,000."}, {"bill": 5129, "section": "section_24", "sentence": "(8)(a) A unit owners association that willfully violates this section is liable to the unit owner for actual damages, and shall pay a civil penalty to the unit owner in an amount not to exceed $1,000."}, {"bill": 5129, "section": "section_26", "sentence": "Any other payments you make to the seller of a unit are at risk and may be lost if the seller defaults.\" (g) \"CONSTRUCTION DEFECT CLAIMS."}, {"bill": 5229, "section": "section_1", "sentence": "(44) \"Professional person\" means a mental health professional, substance use disorder professional, or designated crisis responder and shall also mean a physician, physician assistant, psychiatric advanced registered nurse practitioner, registered nurse, and such others as may be defined by rules adopted by the secretary pursuant to the provisions of this chapter;"}, {"bill": 5284, "section": "section_101", "sentence": "(1) The legislature finds that, as of 2025: (a) Washington's statewide waste recovery rate has been generally static since 2011 and Washington is not meeting the statewide goal of 50 percent recycling established in 1989; and (b) Many residents, particularly those who live in rural areas and in multifamily residences, do not have access to convenient or affordable curbside recycling, and must rely on taking recyclables to drop box locations, and that extended producer responsibility programs could make curbside recycling available and affordable for most people in the state."}, {"bill": 5296, "section": "section_4", "sentence": "(3) Excluding the offenses listed in RCW 13.40.160 (1)(b), the juvenile court maintains concurrent jurisdiction over a juvenile who is committed to the department and shall schedule review hearings every six months that the juvenile is in the custody of a juvenile rehabilitation facility to assess the youth's progress."}, {"bill": 5296, "section": "section_8", "sentence": "Information regarding victims, next of kin, or witnesses requesting the notice, information regarding any other person specified in writing by the prosecuting attorney to receive the notice, and the notice are confidential and shall not be available to the juvenile."}, {"bill": 5352, "section": "section_7", "sentence": "(3) Household income information received by the office of the superintendent of public instruction, school employees, school district employees, or their designees in accordance with this section is exempt from disclosure under chapter 42.56 RCW and may not be disseminated except as provided by law."}, {"bill": 5352, "section": "section_9", "sentence": "(4) The bonuses provided under this section are in addition to compensation received under a district's salary schedule adopted in accordance with RCW 28A.405.200 and shall not be included in calculations of a district's average salary and associated salary limitations under RCW 28A.400.200 ."}, {"bill": 5374, "section": "section_3", "sentence": "(6)(a) Documents prepared by or for the council are inadmissible and may not be used in a civil or administrative proceeding, except that any document that exists before its use or consideration in a review by the council, or that is created independently of such review, does not become inadmissible merely because it is reviewed or used by the council."}, {"bill": 5674, "section": "section_2", "sentence": "Once filed, the exemption is valid for six years or eight years and may not be renewed."}, {"bill": 5685, "section": "section_2", "sentence": "(b) A conviction vacated on or after July 28, 2019, qualifies as a prior conviction for the purpose of charging a present recidivist offense occurring on or after July 28, 2019, and may be used to establish an ongoing pattern of abuse for purposes of RCW 9.94A.535 . --- END ---"}, {"bill": 5732, "section": "section_3", "sentence": "The following goals are not listed in order of priority and shall be used exclusively for the purpose of guiding the development of comprehensive plans, development regulations, and, where specified, regional plans, policies, and strategies: (1) Urban growth."}]`);

// ─── CATEGORY 1: defining phrases that look like requirements ──────────────

const CAT1_RE = /\b(shall|must|may)(\s+not)?\s+(also\s+mean|mean|be\s+construed|be\s+deemed|be\s+interpreted|be\s+understood|be\s+taken\s+to\s+mean)\b/gi;

function findCat1(sentence) {
  const matches = [];
  for (const m of sentence.matchAll(CAT1_RE)) {
    const reqWord = m[1].toLowerCase();
    const not = !!m[2];
    const verbPhrase = m[3].toLowerCase().replace(/\s+/g, " ");
    const phraseKey = `${reqWord}${not ? "_not" : ""} ${verbPhrase}`;
    const before = sentence.slice(0, m.index);
    const hasEarlierMeans = /\bmeans\b/i.test(before);
    matches.push({ phraseKey, matchText: m[0], hasEarlierMeans, index: m.index });
  }
  return matches;
}

// ─── CATEGORY 2: phrases pointing outside the sentence ─────────────────────

const CAT2_PHRASES = [
  "in addition to", "notwithstanding", "pursuant to", "in accordance with",
  "as provided in", "except as provided in", "subject to", "under chapter",
  "under RCW", "falls under", "fall under",
];

const CITATION_RE = /\bRCW\s+[\d.]+|\bchapter\s+\d+|\bsection\s+\d+|\btitle\s+\d+|\b\d+\.\d+|\bch\.\s*\d+/i;

function findCat2(sentence) {
  const matches = [];
  for (const phrase of CAT2_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi");
    for (const m of sentence.matchAll(re)) {
      const after = sentence.slice(m.index + m[0].length);
      const nextWords = after.trim().split(/\s+/).slice(0, 10).join(" ");
      const named = CITATION_RE.test(nextWords);
      matches.push({ phrase, matchText: m[0], named, index: m.index });
    }
  }
  return matches;
}

// ─── CATEGORY 3: preamble sections ──────────────────────────────────────────

const LEGISLATURE_FINDS_RE = /^(\(\w+\)\s*)*The legislature (finds|further finds|declares|recognizes|intends)\b/i;
const THEREFORE_RE = /^(\(\w+\)\s*)*Therefore\b/i;
const REQ_WORD_RE = /\b(shall|must|may)\b/i;

function classifySection(sentences) {
  const total = sentences.length;
  let legislatureFindsCount = 0;
  let hasTherefore = false;
  let reqWordSentenceCount = 0;
  for (const s of sentences) {
    if (LEGISLATURE_FINDS_RE.test(s)) legislatureFindsCount++;
    if (THEREFORE_RE.test(s)) hasTherefore = true;
    if (REQ_WORD_RE.test(s)) reqWordSentenceCount++;
  }
  const isPreamble = total > 0 && legislatureFindsCount > total / 2;
  return { total, legislatureFindsCount, hasTherefore, reqWordSentenceCount, isPreamble };
}

// ─── Structural-outlier check: matched a category pattern but doesn't look ──
// like the confirmed examples (very rough shape check, informational only)

function looksLikeConfirmedCat1(sentence) {
  return /\bmeans?\b/i.test(sentence) || /"[^"]+"/.test(sentence) || /'[^']+'/.test(sentence);
}

function looksLikeConfirmedCat2(matchText) {
  return true; // all listed phrases are inherently the confirmed shape; kept for symmetry
}

// ─── CATEGORY 4: acting party named at the end, in a "by" phrase ───────────

const PARTICIPLE_IRREGULAR = new Set([
  "given", "shown", "taken", "made", "done", "known", "seen", "held", "kept",
  "sent", "built", "brought", "bought", "found", "paid", "said", "told",
  "sold", "begun", "broken", "chosen", "driven", "written", "spoken",
  "stolen", "worn", "torn", "grown", "thrown", "drawn", "flown", "set",
]);

function isParticiple(word) {
  const w = word.toLowerCase();
  return /ed$/.test(w) || PARTICIPLE_IRREGULAR.has(w);
}

const CAT4_RE = /\b(shall|must|may)(\s+not)?\s+be\s+([a-zA-Z]+)\b/gi;
const BY_ACTOR_RE = /\bby\s+([a-z][\w\s'’-]{0,60}?)(?=[,.;:]| and\b| or\b|$)/i;
const AND_REQ_WORD_RE = /\band\b\s+(shall|must|may)\b/i;

const CONDITION_PHRASES = [
  "in violation of", "if", "unless", "when", "found to be", "who fails to",
  "upon conviction", "for failure to", "in excess of", "without a",
  "not in compliance with",
];

function findConditionPhrases(sentence) {
  const found = [];
  for (const phrase of CONDITION_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(sentence)) found.push(phrase);
  }
  return found;
}

function findCat4(sentence) {
  const matches = [];
  const hasAndReqWordTrigger = AND_REQ_WORD_RE.test(sentence);
  const conditionPhrases = findConditionPhrases(sentence);
  for (const m of sentence.matchAll(CAT4_RE)) {
    const word = m[3];
    if (!isParticiple(word)) continue;
    const reqWord = m[1].toLowerCase();
    const not = !!m[2];
    const after = sentence.slice(m.index + m[0].length);
    const byMatch = after.match(BY_ACTOR_RE);
    const actorNamed = !!byMatch;
    const actorPhrase = byMatch ? byMatch[0].trim() : null;
    matches.push({
      reqWord, not, participle: word.toLowerCase(), actorNamed, actorPhrase,
      conditionPhrases, hasAndReqWordTrigger, index: m.index,
    });
  }
  return matches;
}

function looksLikeConfirmedCat4(matches) {
  return matches.some((m) => m.actorNamed && m.conditionPhrases.length > 0);
}

// ─── CANDIDATE SIGNAL WORDS: seize/forfeit/confiscate/impound/contraband ───

const SIGNAL_WORDS = [
  { word: "seize", re: /\bseize\b/i },
  { word: "seized", re: /\bseized\b/i },
  { word: "seizure", re: /\bseizures?\b/i },
  { word: "forfeit", re: /\bforfeit\b/i },
  { word: "forfeited", re: /\bforfeited\b/i },
  { word: "forfeiture", re: /\bforfeitures?\b/i },
  { word: "confiscate", re: /\bconfiscate\b/i },
  { word: "confiscated", re: /\bconfiscated\b/i },
  { word: "impound", re: /\bimpound\b/i },
  { word: "impounded", re: /\bimpounded\b/i },
  { word: "contraband", re: /\bcontraband\b/i },
];

const PROPERTY_LAW_RE = /\bsei[sz]ed\s+of\b/i;
const MEDICAL_CONTEXT_RE = /\b(epilep\w*|seizure disorder|anti-?seizure|medication|medical|health|nurse|school|student|physician|diagnos\w*|neurolog\w*|brain|epinephrine|rescue medication)\b/i;

function findSignalWords(sentence) {
  const words = [];
  for (const { word, re } of SIGNAL_WORDS) {
    if (re.test(sentence)) words.push(word);
  }
  return words;
}

function classifySignalSentence(sentence, matchedWords) {
  if (PROPERTY_LAW_RE.test(sentence)) return "PROPERTY_LAW";
  const hasSeizureWord = matchedWords.some((w) => w.startsWith("seizure"));
  if (hasSeizureWord && MEDICAL_CONTEXT_RE.test(sentence)) return "MEDICAL";
  return "GENERAL";
}

// ─── Main ───────────────────────────────────────────────────────────────────

const out = [];
const log = (line = "") => out.push(line);

log(`Pool size (excluding sentinels, no-document bills, and 4000-4999/8000-8999 ranges): ${pool.length}`);
log(`Sampling every ${step} bills, ${batch.length} bills total: ${batch.join(", ")}\n`);

const billSectionsCache = new Map();
let billsFetchedOk = 0;

const cat1Seen = new Map();
const cat2Seen = new Map();
const cat4Seen = new Map();
const signalGeneralSeen = new Map();
const signalMedicalSeen = new Map();
const signalPropertyLawSeen = new Map();
const preambleSections = [];
const outlierCat1 = [];
const outlierCat4 = [];
let totalSectionsScanned = 0;
let totalReqWordSentencesInPreamble = 0;

for (const billNumber of batch) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), BIENNIUM);
  } catch (err) {
    log(`Bill ${billNumber}: SKIP — ${err.message}`);
    continue;
  }
  billsFetchedOk++;
  billSectionsCache.set(billNumber, data.sections || []);

  for (const section of data.sections || []) {
    if (!section.text?.trim()) continue;
    const sentences = splitSentences(section.text);
    totalSectionsScanned++;

    const cls = classifySection(sentences);
    if (cls.isPreamble) {
      preambleSections.push({ bill: billNumber, section: section.id, ...cls });
      totalReqWordSentencesInPreamble += cls.reqWordSentenceCount;
    }

    for (const sentence of sentences) {
      const cat1Matches = findCat1(sentence);
      if (cat1Matches.length > 0) {
        if (cat1Seen.has(sentence)) {
          cat1Seen.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        } else {
          cat1Seen.set(sentence, { matches: cat1Matches, occurrences: [{ bill: billNumber, section: section.id }] });
          if (!looksLikeConfirmedCat1(sentence)) {
            outlierCat1.push({ sentence, bill: billNumber, section: section.id, matches: cat1Matches });
          }
        }
      }

      const cat2Matches = findCat2(sentence);
      if (cat2Matches.length > 0) {
        if (cat2Seen.has(sentence)) {
          cat2Seen.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        } else {
          cat2Seen.set(sentence, { matches: cat2Matches, occurrences: [{ bill: billNumber, section: section.id }] });
        }
      }

      const cat4Matches = findCat4(sentence);
      if (cat4Matches.length > 0) {
        if (cat4Seen.has(sentence)) {
          cat4Seen.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        } else {
          cat4Seen.set(sentence, { matches: cat4Matches, occurrences: [{ bill: billNumber, section: section.id }] });
          if (!looksLikeConfirmedCat4(cat4Matches)) {
            outlierCat4.push({ sentence, bill: billNumber, section: section.id, matches: cat4Matches });
          }
        }
      }

      const signalWords = findSignalWords(sentence);
      if (signalWords.length > 0) {
        const group = classifySignalSentence(sentence, signalWords);
        const targetMap = group === "PROPERTY_LAW" ? signalPropertyLawSeen : group === "MEDICAL" ? signalMedicalSeen : signalGeneralSeen;
        if (targetMap.has(sentence)) {
          targetMap.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        } else {
          const conditionPhrases = findConditionPhrases(sentence);
          targetMap.set(sentence, { words: signalWords, conditionPhrases, occurrences: [{ bill: billNumber, section: section.id }] });
        }
      }
    }
  }
}

// ─── Category 1 output ──────────────────────────────────────────────────────

log(`\n=== CATEGORY 1: defining phrases that look like requirements ===`);
log(`Total distinct sentences matched: ${cat1Seen.size}`);
const cat1PhraseCounts = {};
let idx = 0;
for (const [sentence, { matches, occurrences }] of cat1Seen.entries()) {
  idx++;
  for (const m of matches) cat1PhraseCounts[m.phraseKey] = (cat1PhraseCounts[m.phraseKey] || 0) + 1;
  const firstOcc = occurrences[0];
  const dupNote = occurrences.length > 1
    ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  const phraseLabel = matches.map(m => `"${m.matchText.trim()}"(hasEarlierMeans=${m.hasEarlierMeans})`).join(", ");
  log(`--- CAT1 ${idx} — bill ${firstOcc.bill}, section ${firstOcc.section}, matches=[${phraseLabel}]${dupNote} ---`);
  log(`sentence: ${singleLine(sentence)}`);
  log("");
}
log(`Per-phrase breakdown:`);
for (const [phrase, count] of Object.entries(cat1PhraseCounts).sort((a, b) => b[1] - a[1])) {
  log(`  ${phrase}: ${count}`);
}
log(`\nCategory 1 structural outliers (matched pattern but doesn't look like confirmed shape) (${outlierCat1.length}):`);
outlierCat1.forEach((o, i) => {
  log(`  outlier ${i + 1} — bill ${o.bill}, section ${o.section}: ${singleLine(o.sentence)}`);
});

// ─── Category 2 output ──────────────────────────────────────────────────────

log(`\n\n=== CATEGORY 2: phrases pointing outside the sentence ===`);
log(`Total distinct sentences matched: ${cat2Seen.size}`);
const cat2PhraseCounts = {};
let namedCount = 0;
let unnamedCount = 0;
idx = 0;
for (const [sentence, { matches, occurrences }] of cat2Seen.entries()) {
  idx++;
  for (const m of matches) {
    const key = `${m.phrase} [${m.named ? "NAMED" : "UNNAMED"}]`;
    cat2PhraseCounts[key] = (cat2PhraseCounts[key] || 0) + 1;
    if (m.named) namedCount++; else unnamedCount++;
  }
  const firstOcc = occurrences[0];
  const dupNote = occurrences.length > 1
    ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  const phraseLabel = matches.map(m => `"${m.matchText}"(${m.named ? "NAMED" : "UNNAMED"})`).join(", ");
  log(`--- CAT2 ${idx} — bill ${firstOcc.bill}, section ${firstOcc.section}, matches=[${phraseLabel}]${dupNote} ---`);
  log(`sentence: ${singleLine(sentence)}`);
  log("");
}
log(`Per-phrase breakdown (with NAMED/UNNAMED split):`);
for (const [key, count] of Object.entries(cat2PhraseCounts).sort((a, b) => b[1] - a[1])) {
  log(`  ${key}: ${count}`);
}
log(`\nTotal occurrences: NAMED=${namedCount}, UNNAMED=${unnamedCount}`);

// ─── Category 3 output ──────────────────────────────────────────────────────

log(`\n\n=== CATEGORY 3: preamble sections ===`);
log(`Total sections scanned: ${totalSectionsScanned}`);
log(`Sections classified PREAMBLE: ${preambleSections.length}`);
log(`Requirement-word sentences found inside PREAMBLE sections: ${totalReqWordSentencesInPreamble}`);
log(`\nPREAMBLE sections:`);
preambleSections.forEach((p, i) => {
  log(`  ${i + 1}. bill ${p.bill}, section ${p.section} — total_sentences=${p.total}, legislature_finds_sentences=${p.legislatureFindsCount}, has_therefore=${p.hasTherefore}, req_word_sentences=${p.reqWordSentenceCount}`);
});

// ─── Category 4 output ──────────────────────────────────────────────────────

log(`\n\n=== CATEGORY 4: acting party named at the end, in a "by" phrase ===`);
log(`Total distinct sentences matched (passive req-word construction): ${cat4Seen.size}`);
let actorNamedCount = 0;
let noActorNamedCount = 0;
let actorNamedAndAndTrigger = 0;
let cat4WithCondition = 0;
let cat4NoCondition = 0;
idx = 0;
for (const [sentence, { matches, occurrences }] of cat4Seen.entries()) {
  idx++;
  const anyActorNamed = matches.some((m) => m.actorNamed);
  const anyCondition = matches.some((m) => m.conditionPhrases.length > 0);
  const anyAndTrigger = matches.some((m) => m.hasAndReqWordTrigger);
  if (anyActorNamed) actorNamedCount++; else noActorNamedCount++;
  if (anyActorNamed && anyAndTrigger) actorNamedAndAndTrigger++;
  if (anyCondition) cat4WithCondition++; else cat4NoCondition++;

  const firstOcc = occurrences[0];
  const dupNote = occurrences.length > 1
    ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  const matchLabel = matches.map(m => {
    const forceLabel = `${m.reqWord}${m.not ? "_not" : ""} be ${m.participle}`;
    const actorLabel = m.actorNamed ? `ACTOR-NAMED-AT-END("${m.actorPhrase}")` : "NO-ACTOR-NAMED";
    const condLabel = m.conditionPhrases.length ? `conditions=[${m.conditionPhrases.join(";")}]` : "conditions=none";
    return `${forceLabel}|${actorLabel}|${condLabel}|and_req_word_trigger=${m.hasAndReqWordTrigger}`;
  }).join(" ;; ");
  log(`--- CAT4 ${idx} — bill ${firstOcc.bill}, section ${firstOcc.section}${dupNote} ---`);
  log(`sentence: ${singleLine(sentence)}`);
  log(`  matches: ${matchLabel}`);
  log("");
}
log(`ACTOR-NAMED-AT-END: ${actorNamedCount}. NO-ACTOR-NAMED: ${noActorNamedCount}.`);
log(`ACTOR-NAMED-AT-END sentences that also contain "and" immediately followed by a requirement word: ${actorNamedAndAndTrigger}`);
log(`Sentences carrying a condition phrase: ${cat4WithCondition}. Sentences with no condition phrase: ${cat4NoCondition}.`);
log(`\nCategory 4 structural outliers (matched pattern but lacks actor-named-at-end + a condition phrase together) (${outlierCat4.length}):`);
outlierCat4.forEach((o, i) => {
  log(`  outlier ${i + 1} — bill ${o.bill}, section ${o.section}: ${singleLine(o.sentence)}`);
});

// ─── Candidate signal words output ─────────────────────────────────────────

function logSignalGroup(label, map) {
  log(`\n${label} (${map.size} distinct sentences):`);
  const wordCounts = {};
  let withCondition = 0;
  let noCondition = 0;
  let i = 0;
  for (const [sentence, { words, conditionPhrases, occurrences }] of map.entries()) {
    i++;
    for (const w of words) wordCounts[w] = (wordCounts[w] || 0) + 1;
    if (conditionPhrases.length > 0) withCondition++; else noCondition++;
    const firstOcc = occurrences[0];
    const dupNote = occurrences.length > 1
      ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
      : "";
    log(`  --- ${label} ${i} — bill ${firstOcc.bill}, section ${firstOcc.section}, words=[${words.join(",")}], conditions=[${conditionPhrases.join(";") || "none"}]${dupNote} ---`);
    log(`  sentence: ${singleLine(sentence)}`);
  }
  log(`  Per-word breakdown: ${JSON.stringify(wordCounts)}`);
  log(`  With condition phrase: ${withCondition}. Without: ${noCondition}.`);
  return { wordCounts, withCondition, noCondition };
}

log(`\n\n=== CANDIDATE SIGNAL WORDS: seize/forfeit/confiscate/impound/contraband ===`);
log(`(GENERAL group excludes sentences classified MEDICAL or PROPERTY_LAW below)`);
const generalStats = logSignalGroup("SIGNAL-GENERAL", signalGeneralSeen);
const medicalStats = logSignalGroup("SIGNAL-MEDICAL (excluded, medical-event meaning)", signalMedicalSeen);
const propertyStats = logSignalGroup("SIGNAL-PROPERTY-LAW (excluded, \"seized of\"/\"seised of\" an estate)", signalPropertyLawSeen);
log(`\nTotal signal-word sentences across all three groups: ${signalGeneralSeen.size + signalMedicalSeen.size + signalPropertyLawSeen.size} (GENERAL=${signalGeneralSeen.size}, MEDICAL=${signalMedicalSeen.size}, PROPERTY_LAW=${signalPropertyLawSeen.size})`);

// ─── Cross-check against round 2's 39 FIRST_SIDE_NOT_A_DUTY suppressions ───

log(`\n\n=== CROSS-CHECK: round 2's FIRST_SIDE_NOT_A_DUTY suppressions against these 4 categories ===`);
log(`(Round 2 recorded 39 distinct suppressions; task text says "40" -- this cross-checks the 39 actually on record.)`);
let matchedAny = 0;
const crossCheckResults = [];
for (const entry of ROUND2_BASELINE) {
  const cat1Matches = findCat1(entry.sentence);
  const cat2Matches = findCat2(entry.sentence);
  const cat4Matches = findCat4(entry.sentence);
  let inPreambleSection = false;
  let sectionInfo = null;
  const sections = billSectionsCache.get(entry.bill);
  if (sections) {
    const sec = sections.find((s) => s.id === entry.section);
    if (sec && sec.text) {
      const sentences = splitSentences(sec.text);
      const cls = classifySection(sentences);
      inPreambleSection = cls.isPreamble;
      sectionInfo = cls;
    }
  }
  const categories = [];
  if (cat1Matches.length > 0) categories.push("CATEGORY_1");
  if (cat2Matches.length > 0) categories.push("CATEGORY_2");
  if (inPreambleSection) categories.push("CATEGORY_3");
  if (cat4Matches.length > 0) categories.push("CATEGORY_4");
  if (categories.length > 0) matchedAny++;
  crossCheckResults.push({ ...entry, categories, cat1Matches, cat2Matches, cat4Matches, sectionInfo });
}
log(`Of 39 suppressed sentences, ${matchedAny} matched at least one of the 4 categories; ${39 - matchedAny} matched none.`);
crossCheckResults.forEach((r, i) => {
  const catLabel = r.categories.length ? r.categories.join(",") : "none";
  const cat2Label = r.cat2Matches.map(m => `${m.phrase}(${m.named ? "NAMED" : "UNNAMED"})`).join(";");
  const cat4Label = r.cat4Matches.map(m => `${m.reqWord} be ${m.participle}|${m.actorNamed ? "ACTOR-NAMED" : "NO-ACTOR"}`).join(";");
  log(`--- CROSSCHECK ${i + 1} — bill ${r.bill}, section ${r.section}, categories=[${catLabel}]${r.cat2Matches.length ? `, cat2_phrases=[${cat2Label}]` : ""}${r.cat4Matches.length ? `, cat4=[${cat4Label}]` : ""} ---`);
  log(`sentence: ${singleLine(r.sentence)}`);
});

log(`\nDone. ${batch.length} bills sampled, ${billsFetchedOk} bills fetched successfully, ${totalSectionsScanned} sections scanned.`);
log(`Category 1: ${cat1Seen.size} distinct sentences. Category 2: ${cat2Seen.size} distinct sentences (NAMED=${namedCount}, UNNAMED=${unnamedCount}). Category 3: ${preambleSections.length} preamble sections, ${totalReqWordSentencesInPreamble} requirement-word sentences inside them.`);
log(`Category 4: ${cat4Seen.size} distinct sentences (ACTOR-NAMED-AT-END=${actorNamedCount}, NO-ACTOR-NAMED=${noActorNamedCount}, actor-named-and-and-trigger=${actorNamedAndAndTrigger}, with-condition=${cat4WithCondition}, no-condition=${cat4NoCondition}).`);
log(`Signal words: GENERAL=${signalGeneralSeen.size}, MEDICAL=${signalMedicalSeen.size}, PROPERTY_LAW=${signalPropertyLawSeen.size}.`);
log(`Cross-check: ${matchedAny} of 39 round-2 suppressions matched at least one category.`);

writeFileSync(OUTPUT_FILE, out.join("\n"), "utf8");

console.log(`Pool size: ${pool.length}, sampled ${batch.length} bills, ${billsFetchedOk} fetched ok.`);
console.log(`Category 1: ${cat1Seen.size} sentences. Category 2: ${cat2Seen.size} sentences (NAMED=${namedCount}, UNNAMED=${unnamedCount}).`);
console.log(`Category 3: ${preambleSections.length} preamble sections of ${totalSectionsScanned} scanned, ${totalReqWordSentencesInPreamble} req-word sentences inside them.`);
console.log(`Category 4: ${cat4Seen.size} sentences (ACTOR-NAMED=${actorNamedCount}, NO-ACTOR=${noActorNamedCount}).`);
console.log(`Signal words: GENERAL=${signalGeneralSeen.size}, MEDICAL=${signalMedicalSeen.size}, PROPERTY_LAW=${signalPropertyLawSeen.size}.`);
console.log(`Cross-check: ${matchedAny} of 39 matched.`);
console.log(`Full results written to ${OUTPUT_FILE}`);
