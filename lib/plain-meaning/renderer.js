import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalize } from "./lang-normalizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS = JSON.parse(
  readFileSync(path.join(__dirname, "..", "translations.json"), "utf8")
);
const DICTIONARY = JSON.parse(
  readFileSync(path.join(__dirname, "..", "action-dictionary.json"), "utf8")
);

// ─── Scope lens classifier ────────────────────────────────────────────────────

const LENS_PATTERNS = [
  {
    lens: "obligation_removal",
    re: /\b(no longer required|not required|no obligation|removed\b|waived\b|exempted\b|no longer\s+\w+)\b/i,
  },
  {
    lens: "threshold_shift",
    re: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety)\s*(?:percent|%|business days?|days?|months?|years?|hours?|weeks?)\b|\bno (?:less|more|fewer) than\b|\bat (?:least|most)\b|\bminimum\b|\bmaximum\b|\bno later than\b|\bthreshold\b|\bstandard\b|\b(?:round(?:ed|ing)|adjust(?:ed|ing|ment))\b/i,
  },
  {
    lens: "actor_power_shift",
    // "reports to" (verb form with 's') — avoids matching "submit a report to"
    re: /\b(responsible for|authority|authorized to|delegat(?:ed|e|ion)|approved by|reports\s+to|in consultation with|under the direction of)\b/i,
  },
  {
    lens: "action_domain_shift",
    re: /\b(inspect(?:ion)?|audit|review|assess(?:ment)?|monitor(?:ing)?|certif(?:y|ied|ication)|submit(?:ting)?|conduct|perform|train(?:ing)?|document(?:ation)?|implement|maintain(?:ance)?)\b/i,
  },
  {
    lens: "scope_change",
    re: /\bthroughout\b|\bacross all\b|\ball covered\b|\bapplies?\s+to\b|\bregardless of\b/i,
  },
];

function classifyLens(unit) {
  const text = String(unit.tetherAnchor?.anchorText || "");
  const conditions = (unit.parse?.what?.conditions || []).join(" ");
  const haystack = `${text} ${conditions}`;

  for (const { lens, re } of LENS_PATTERNS) {
    if (re.test(haystack)) return lens;
  }
  return "modality_shift";
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function modalVerb(modal, signal) {
  const m = String(modal || signal || "").toLowerCase();
  if (
    m.includes("shall not") ||
    m.includes("must not") ||
    m.includes("may not") ||
    m === "cannot" ||
    signal === "prohibition"
  )
    return "cannot";
  // SSE signal takes priority over positional MODAL_RE match: a sentence where
  // "may" appears before "shall" in the text would otherwise return "may" even
  // though SSE classified the sentence as obligation.
  if (signal === "obligation") return "must";
  if (
    m === "may" ||
    m.includes("permitted") ||
    m.includes("authorized") ||
    signal === "permission"
  )
    return "may";
  return "must";
}

function cleanActor(actor) {
  if (!actor) return null;
  return actor.replace(/,\s*$/, "").trim();
}

const NUM_PATTERN = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety|one hundred)";
const UNIT_PATTERN = "(?:business\\s+)?(?:days?|months?|years?|hours?|weeks?)";
const TEMPORAL_SUFFIX_RE = new RegExp(
  `\\s+within\\s+${NUM_PATTERN}\\s+${UNIT_PATTERN}[^,;.]*|\\s+no later than\\s+[^;.]{3,60}`,
  "gi"
);

function cleanAction(action) {
  if (!action) return null;
  return action
    .replace(/^at\s+intervals?\s+[^,]{1,60},\s*/i, "")
    .replace(TEMPORAL_SUFFIX_RE, "")
    .replace(/^,\s*/, "")
    .replace(/[.;,\s]+$/, "")
    .trim() || null;
}

// ─── Plain-English fallback for unparseable signal sentences ──────────────────

const LEGALESE = [
  [/\bshall not\b/gi, "may not"],
  [/\bshall\b/gi, "must"],
  [/\bis required to\b/gi, "must"],
  [/\bare required to\b/gi, "must"],
  [/\bis authorized to\b/gi, "may"],
  [/\bare authorized to\b/gi, "may"],
  [/\bis prohibited from\b/gi, "may not"],
  [/\bare prohibited from\b/gi, "may not"],
  [/\bobligated to\b/gi, "must"],
  [/\bpursuant to\b/gi, "under"],
  [/\bin accordance with\b/gi, "under"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequent to\b/gi, "after"],
  [/\bnotwithstanding\b/gi, "despite"],
  [/\bin the event that\b/gi, "if"],
  [/\bfor the purpose of\b/gi, "to"],
  [/\bwith respect to\b/gi, "about"],
  [/\bin connection with\b/gi, "related to"],
  [/\bat the time of\b/gi, "when"],
  [/\bprovided that\b/gi, "if"],
  [/\bin lieu of\b/gi, "instead of"],
  [/\bon behalf of\b/gi, "for"],
  [/\bhereinafter\b/gi, ""],
  [/\bthereafter\b/gi, "after that"],
  [/\bthereof\b/gi, "of it"],
  [/\btherein\b/gi, "in it"],
  [/\bthereto\b/gi, "to it"],
  [/\bheretofore\b/gi, "previously"],
  [/\bhereafter\b/gi, "going forward"],
];

function plainify(text) {
  if (!text) return null;
  let s = String(text)
    .replace(/^\s*(?:NEW SECTION\.\s+)?Sec\.\s+\d+\.?\s*/i, "")
    .replace(/^\s*Section\s+\d+[.:)]\s*/i, "");
  for (const [pattern, replacement] of LEGALESE) {
    s = s.replace(pattern, replacement);
  }
  s = s.replace(/\s+/g, " ").trim();

  // Try to reconstruct a clean subject–modal–action sentence.
  // Order matters: "may not" must be tested before "may".
  const modalRe = /\b(may not|cannot|must|may)\b/i;
  const mMatch = s.match(modalRe);
  if (!mMatch) return null;

  // Subject: text before the modal, with leading prepositional/subordinate
  // clauses stripped ("In consultation with X, ...", "If X, ...", etc.)
  let subject = s.slice(0, mMatch.index).replace(/[,\s]+$/, "").trim();
  subject = subject.replace(
    /^(?:in|on|under|with|for|by|at|to|from|if|when|unless|although|despite|subject to)\s+[^,]{3,},\s*/i,
    ""
  ).trim();
  if (!subject || subject.split(/\s+/).length > 10) return null;

  // Action: text after the modal; strip embedded ", clause," so "must, by
  // December 31, submit" becomes "must submit"
  let action = s.slice(mMatch.index + mMatch[0].length)
    .replace(/^,\s*[^,]+,\s*/, "")
    .replace(/;.*$/, "")
    .replace(/\.?\s*$/, "")
    .trim();
  if (!action || action.split(/\s+/).length < 2) return null;
  if (action.split(/\s+/).length > 25) {
    action = action.split(/\s+/).slice(0, 25).join(" ") + "…";
  }

  const out = `${subject} ${mMatch[1].toLowerCase()} ${action}`;
  return out.length > 280 ? finalize(`${out.slice(0, 277).trimEnd()}…`) : finalize(out);
}

function firstDeadline(deadlines) {
  return (deadlines || []).find((d) => d && d.length > 4) || null;
}

function firstCondition(conditions) {
  return (conditions || []).find((c) => c && c.length > 4) || null;
}

function alreadyPresent(sentence, phrase) {
  if (!phrase) return true;
  return sentence.toLowerCase().includes(phrase.toLowerCase().slice(0, 18));
}

// ─── Template functions ───────────────────────────────────────────────────────

const TEMPLATES = {
  modality_shift({ actor, modal, action, conditions, deadlines, enforcement }) {
    if (!action && !actor) return null;
    const act = cleanAction(action) || "follow this requirement";

    let s;
    if (actor) {
      s = `${cleanActor(actor)} ${modal} ${act}`;
    } else {
      const verb = modal === "must" ? "requires" : modal === "may" ? "allows" : "prohibits";
      s = `This section ${verb}: ${act}`;
    }
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${dl}`;
    if (enforcement) s += `. Failure to comply: ${enforcement}`;
    return s;
  },

  actor_power_shift({ actor, action, conditions }) {
    if (!actor) return null;
    const subject = cleanActor(actor);
    // Strip "be responsible for" / "responsible for" prefix so the template
    // doesn't double up when the source text already contains that phrase
    const rawAct = cleanAction(action);
    const act = rawAct
      ?.replace(/^be\s+responsible\s+for\s+/i, "")
      .replace(/^responsible\s+for\s+/i, "")
      .trim() || null;

    let s = act
      ? `${subject} is responsible for ${act}`
      : `${subject} is in charge of this`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    return s;
  },

  scope_change({ actor, modal, action, conditions, deadlines }) {
    if (!action && !actor) return null;
    const subject = actor ? cleanActor(actor) : "This requirement";
    const act = cleanAction(action);

    let s = act
      ? `${subject} ${modal} ${act}`
      : `${subject} applies to everyone involved`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${dl}`;
    return s;
  },

  threshold_shift({ actor, modal, action, conditions, deadlines }) {
    if (!action) return null;
    const act = cleanAction(action);

    // Cash register template: rounding language must be accompanied by cent-level
    // amounts. Prevents firing on dollar allocations ("adjusted for inflation",
    // "rounded to the nearest dollar", education/appropriation contexts).
    const hasRounding = /\b(round(?:ed|ing)?)\b/i.test(act || "");
    const hasCentAmount = /\bcents?\b|\bnickel\b|\bdime\b|\bfive.cent\b/i.test(act || "");

    if (hasRounding && hasCentAmount) {
      const cond = firstCondition(conditions);
      const rawActor = actor ? cleanActor(actor).toLowerCase() : "";
      const cashContext = /cash|payment|transaction|purchase/i.test(`${rawActor} ${cond || ""}`);

      const lead = cond
        ? `${cond.charAt(0).toUpperCase()}${cond.slice(1)}`
        : cashContext
        ? "When you pay cash"
        : rawActor
        ? `For ${rawActor}`
        : "In this case";

      return `${lead}, your total will ${act}`;
    }

    const subject = actor ? cleanActor(actor) : "This section";
    const verb = actor ? modal : "requires";
    const threshold =
      firstDeadline(deadlines) ||
      (conditions || []).find((c) => /\d/.test(c)) ||
      firstCondition(conditions);

    let s = actor ? `${subject} ${verb} ${act}` : `${subject} ${verb}: ${act}`;
    if (threshold && !alreadyPresent(s, threshold)) s += `, ${threshold}`;
    return s;
  },

  action_domain_shift({ actor, modal, action, conditions, deadlines }) {
    if (!action) return null;
    const subject = actor ? cleanActor(actor) : "This section";
    const verb = actor ? modal : "requires";
    const act = cleanAction(action);

    let s = actor ? `${subject} ${verb} ${act}` : `${subject} ${verb}: ${act}`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${dl}`;
    return s;
  },

  obligation_removal({ actor, action, conditions, deadlines, rawModal }) {
    const subject = actor ? cleanActor(actor) : "This section";
    const act = cleanAction(action);
    const copula = /\bare\b/i.test(rawModal || "") ? "are" : "is";

    let s = act
      ? `${subject} ${copula} no longer required to ${act}`
      : `${subject} removes a previous requirement`;

    // If the unit also carries threshold data, include it — a conditional
    // removal ("no longer required after 90 days") is not a blanket removal.
    const threshold =
      firstDeadline(deadlines) ||
      (conditions || []).find((c) => /\d/.test(c)) ||
      null;
    if (threshold && !alreadyPresent(s, threshold)) s += `, ${threshold}`;

    // Append any non-numeric condition not already covered
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;

    return s;
  },
};

// ─── Finalize sentence ────────────────────────────────────────────────────────

function finalize(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s.endsWith(".") && !s.endsWith(":")) s += ".";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fillTemplate(tmpl, vars) {
  return String(tmpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// ─── Action phrase translator — dictionary-only, no inference ─────────────────

function translateActionPhrase(verb, obj, lang) {
  // Try the full phrase (verb + obj) as a single dictionary key first.
  // Needed for passive constructions ("be paid", "be advanced") where the
  // single-word verb "be" resolves to a copula, not the intended passive.
  // Falls back to verb + first-word-of-obj so "be advanced upon request"
  // still matches the "be advanced" dictionary entry.
  if (obj) {
    const objLower = obj.toLowerCase();
    const fullPhrase = `${verb} ${objLower}`;
    let fullEntry = DICTIONARY.verbs?.[fullPhrase];
    if (!fullEntry?.[lang]) {
      const objWords = objLower.split(/\s+/);
      const firstObjWord = objWords[0];
      // Multi-word object: try verb + first word ("be advanced upon…" → "be advanced")
      if (firstObjWord && firstObjWord !== objLower) {
        const shortKey = `${verb} ${firstObjWord}`;
        if (DICTIONARY.verbs?.[shortKey]?.[lang]) fullEntry = DICTIONARY.verbs[shortKey];
      }
      // Depluralize first obj word so "charge fees" → "charge fee" finds the dict entry
      if (!fullEntry?.[lang]) {
        const deplural = firstObjWord
          .replace(/ies$/, 'y')
          .replace(/ves$/, 'f')
          .replace(/(?:ses|xes|zes|ches|shes)$/, '')
          .replace(/s$/, '');
        if (deplural !== firstObjWord) {
          const deplurKey = `${verb} ${deplural}`;
          if (DICTIONARY.verbs?.[deplurKey]?.[lang]) fullEntry = DICTIONARY.verbs[deplurKey];
        }
      }
      // Article skip: "charge a fee" → try "charge fee"
      if (!fullEntry?.[lang] && objWords.length >= 2 && /^(?:a|an|the)$/i.test(firstObjWord)) {
        const afterArticle = objWords.slice(1).join(' ');
        const articleKey = `${verb} ${afterArticle}`;
        if (DICTIONARY.verbs?.[articleKey]?.[lang]) fullEntry = DICTIONARY.verbs[articleKey];
      }
      // Quantifier skip: "charge any fee" → strip "any/each/every/no" → try "charge fee"
      if (!fullEntry?.[lang] && objWords.length >= 2 && /^(?:any|each|every|no)$/i.test(firstObjWord)) {
        const afterQuantifier = objWords.slice(1).join(' ');
        const quantKey = `${verb} ${afterQuantifier}`;
        if (DICTIONARY.verbs?.[quantKey]?.[lang]) fullEntry = DICTIONARY.verbs[quantKey];
      }
    }
    if (fullEntry?.[lang]) {
      const inherentNeg = fullEntry.inherent_negation === true;
      return { translated: lcFirst(fullEntry[lang]), verbMissing: false, objMissing: false, inherentNeg };
    }
  }

  const verbEntry = DICTIONARY.verbs?.[verb];
  let verbTrans = verbEntry?.[lang] ?? null;

  if (!verbTrans) {
    // Normalization retry: normalize the token by language-specific rules and
    // attempt a second lookup. Handles conjugated/inflected forms that don't
    // match the base-form dictionary key.
    const { root: normalizedVerb } = normalize(verb, lang);
    if (normalizedVerb && normalizedVerb !== verb) {
      verbTrans = DICTIONARY.verbs?.[normalizedVerb]?.[lang] ?? null;
    }
  }

  if (!verbTrans) {
    // Verb not in dictionary — English fallback is cleaner than a foreign-language
    // frame wrapping an untranslated verb.
    return { translated: null, verbMissing: true, objMissing: false, inherentNeg: false };
  }

  // Lowercase first character — dictionary values may have been auto-translated
  // with a leading capital; finalize() handles sentence-start capitalization.
  verbTrans = lcFirst(verbTrans);

  const inherentNeg = verbEntry?.inherent_negation === true;

  // When obj is a comma-separated list of short verb phrases, translate each
  // token independently and rejoin. Gate on all-short segments (≤6 words each)
  // to avoid firing on clause-continuation commas or numeric dollar amounts.
  if (obj && obj.includes(",")) {
    const safeForCheck = obj.replace(/(\d),(\d)/g, "$1.$2");
    if (safeForCheck.includes(",")) {
      const segments = safeForCheck.split(/,\s*/);
      if (segments.every(seg => seg.trim().split(/\s+/).length <= 6)) {
        return { ...translateVerbList(verbTrans, obj, lang), inherentNeg };
      }
    }
  }

  const objTrans = obj ? DICTIONARY.objects?.[obj.toLowerCase()]?.[lang] ?? null : null;
  const objMissing = obj ? !objTrans : false;

  // When the object isn't in the dictionary, use the English object rather than
  // falling back to an all-English sentence. The translated verb inside a
  // foreign-language frame is more useful to the reader than a full English
  // fallback, and objMissing triggers the [!] flag to indicate partial translation.
  const frame = DICTIONARY.syntax_frames?.[lang] || ["verb", "object"];
  // Korean: attach object particle (을/를) to Hangul object nouns before SOV assembly.
  // Only applied when the object has a Korean translation — English fallback objects
  // are left as-is since Korean particles don't apply to English words.
  let objOut = objTrans ? lcFirst(objTrans) : (obj ?? null);
  if (lang === "ko" && objTrans) objOut = addKoreanObjectParticle(objOut);
  const parts = frame
    .map(s => (s === "verb" ? verbTrans : s === "object" ? objOut : null))
    .filter(Boolean);

  return { translated: parts.join(" ").trim() || null, verbMissing: false, objMissing, inherentNeg };
}

// Lowercase the first character of a string — used when injecting dictionary
// values mid-sentence so auto-capitalized translations don't appear mid-sentence.
function lcFirst(s) {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// Syllables that, when word-final in a Korean translation, signal the word
// already carries a postposition — adding 을/를 on top would be wrong.
// Covers: accusative (을/를), topic (은/는), nominative (이/가), locative (에),
// also-particle (도), source-locative (서), directional (로).
const KO_ALREADY_MARKED = new Set(['을', '를', '은', '는', '이', '가', '에', '도', '서', '로']);

// Attach Korean object particle (을/를) to Hangul nouns based on whether the
// final syllable has a trailing consonant (받침). Implements the TransitiveVerbPhrase
// composite token pattern for Korean SOV: noun+particle+verb as a single block.
// Only fires on Korean text (U+AC00–U+D7A3 range) — English objects are returned
// unchanged since Korean particles don't apply to non-Hangul words.
function addKoreanObjectParticle(noun) {
  if (!noun) return noun;
  // Skip if the word already ends in a particle syllable (e.g. 외에도 ends in 도)
  if (KO_ALREADY_MARKED.has(noun[noun.length - 1])) return noun;
  const last = noun.charCodeAt(noun.length - 1);
  if (last >= 0xAC00 && last <= 0xD7A3) {
    // Final consonant present when (codePoint - 0xAC00) % 28 !== 0
    return noun + ((last - 0xAC00) % 28 !== 0 ? "을" : "를");
  }
  return noun;
}

// Translate a comma-separated list of verb phrases in the obj slot.
// Each item is looked up independently: first as a full-phrase key, then as
// first-word verb + object. Items that fail lookup stay in English.
// Only failed items set objMissing — not the whole phrase.
function translateVerbList(primaryVerbTrans, obj, lang) {
  // Protect numeric commas (e.g. "$13,750") before splitting on list commas.
  // U+2060 WORD JOINER is a safe placeholder — zero-width, never appears in bill text.
  const _WJ = "⁠";
  const items = obj.replace(/(\d),(\d)/g, `$1${_WJ}$2`).split(/,\s*/).map(s => s.replace(/⁠/g, ","));
  const translated = [primaryVerbTrans];
  let anyMissing = false;

  for (const raw of items) {
    // Capture the English "and" connector BEFORE stripping it. Re-injecting the
    // target-language equivalent after translation preserves list context that
    // downstream sanitizers use to distinguish coordinate list items from
    // detached trailing nouns (Somali hoyga guard, Korean 와/과 structure).
    const conjMatch = /^(and\/or|and)\s+/i.exec(raw);
    const item = raw.replace(/^(?:and\/or|and|or)\s+/i, "").trim();
    if (!item) continue;

    // 1. Try the full item as a dictionary key ("offer for sale", "distribute for use")
    const fullKey = item.toLowerCase().replace(/[.,;:!?]+$/, "");
    let trans = DICTIONARY.verbs?.[fullKey]?.[lang] ?? null;
    // True when the translation was set from a dict lookup with no English object fallback.
    // Used to guard Somali iyo injection — iyo must not prefix mixed-language phrases.
    let itemHasEnglish = false;

    if (!trans) {
      // 2. First-word verb + remainder as object
      const sp = item.indexOf(" ");
      const v = (sp < 0 ? item : item.slice(0, sp)).toLowerCase().replace(/[.,;:!?]+$/, "");
      const o = sp < 0 ? null : item.slice(sp + 1).trim() || null;

      let vTrans = DICTIONARY.verbs?.[v]?.[lang] ?? null;
      if (!vTrans) {
        const { root: norm } = normalize(v, lang);
        if (norm && norm !== v) vTrans = DICTIONARY.verbs?.[norm]?.[lang] ?? null;
      }

      if (vTrans) {
        const oTrans = o ? DICTIONARY.objects?.[o.toLowerCase()]?.[lang] ?? null : null;
        if (o && !oTrans) { anyMissing = true; itemHasEnglish = true; }
        // Apply SOV frame within each list item so Korean/Somali get object-before-verb.
        // For Korean, also attach the object particle (을/를) to Hangul object nouns.
        const frame = DICTIONARY.syntax_frames?.[lang] || ["verb", "object"];
        let oOut = oTrans ? lcFirst(oTrans) : (o ?? null);
        if (lang === "ko" && oTrans) oOut = addKoreanObjectParticle(oOut);
        trans = oOut
          ? (frame[0] === "object" ? `${oOut} ${lcFirst(vTrans)}` : `${lcFirst(vTrans)} ${oOut}`)
          : lcFirst(vTrans);
      }

      // 3. Single-word noun item — try objects dict (handles coordinate noun lists like "meals, lodging")
      if (!trans && !o) {
        const oTrans = DICTIONARY.objects?.[v]?.[lang] ?? null;
        if (oTrans) {
          let oOut = lcFirst(oTrans);
          if (lang === "ko") oOut = addKoreanObjectParticle(oOut);
          trans = oOut;
        }
      }
    }

    if (trans) trans = lcFirst(trans);

    // Re-inject the target-language coordinate conjunction so the translated list
    // preserves the "and" relationship. Somali: inject "iyo" before every non-first
    // item (standard Somali list form — enables the sanitizer hoyga guard).
    // Korean: "and"-prefixed items get 와/과 appended to the preceding item.
    if (lang === "so" && trans && !itemHasEnglish && translated.length > 0 && !trans.startsWith("iyo ")) {
      trans = "iyo " + trans;
    } else if (conjMatch && trans && lang === "ko") {
      // Append 와/과 to the preceding item (Korean attaches conjunction to preceding noun)
      const prev = translated[translated.length - 1];
      if (prev) {
        const prevLast = prev.charCodeAt(prev.length - 1);
        const prevHangul = prevLast >= 0xAC00 && prevLast <= 0xD7A3;
        const conj = prevHangul && (prevLast - 0xAC00) % 28 !== 0 ? "과" : "와";
        translated[translated.length - 1] = prev + conj;
      }
    }

    translated.push(trans ?? raw.trim()); // failed items keep English (with "or"/"and")
    if (!trans) anyMissing = true;
  }

  return { translated: translated.join(", "), verbMissing: false, objMissing: anyMissing };
}

// ─── Korean output sanitizer ─────────────────────────────────────────────────
// Strips parse markers, particle notation, and adjective-form overrides that
// must never appear as literal output text. Applied to all Korean sentences.

function sanitizeKoreanOutput(s) {
  return s
    .replace(/은\(는\)/g, "")
    .replace(/는\(은\)/g, "")
    .replace(/을\(를\)/g, "")
    .replace(/를\(을\)/g, "")
    // \b word-boundary fails adjacent to Hangul — use whitespace/string-edge boundary
    .replace(/(?:^|\s+)be(?:\s+|$)/gi, " ")
    .replace(/완벽한/g, "이수하다")   // adjective form fallback → training verb
    // 하다-verb in obligation template conjugates cleanly: "이수하다 반드시 해야" → "이수해야"
    .replace(/하다\s+반드시\s+해야/g, "해야")
    // Collapse redundancy when dict already stores 해야 form: "이수해야 반드시 해야" → "이수해야"
    .replace(/해야\s+반드시\s+해야/g, "해야")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Somali output sanitizer ─────────────────────────────────────────────────
// Strips the copula "noqon" when it appears as a stray appended token (from
// "be" lookup falling through to the Somali copula). Collapses double
// subordinating particle "in" that can appear when a verb phrase already
// starts with "in" and the "waa in {action}" template wraps it again.

function sanitizeSomaliOutput(s) {
  return s
    .replace(/\s+noqon\.?$/i, "")        // strip stray copula at sentence end
    .replace(/\bin\s+in\b/g, "in")       // collapse consecutive in-in
    .replace(/\biyo\s+in\s+/gi, "iyo ")  // iyo connector must not re-insert the particle
    .replace(/\s+iyo\s+la\s+(?:bixiyo|siiyo)\b/gi, "")  // strip orphaned iyo la bixiyo/siiyo stacking
    // Strip any comma (and optional whitespace) immediately before the sentence period.
    // The broad pattern covers ASCII and Unicode comma variants; the definite-suffix and
    // -aas patterns below are retained as belt-and-suspenders for fused cases.
    .replace(/[,，︐︑﹐]\s*\./g, ".")
    .replace(/,\s*\./g, ".")
    .replace(/(\b\w+(?:ga|ka|da|ta|aas)),\./g, "$1.")
    .replace(/(\w+aas),\./g, "$1.")
    // Strip a bare trailing comma (no period) — finalize runs after and would append a
    // period, producing "word,." which the comma+period patterns above then need to catch.
    .replace(/[,，︐︑﹐]\s*$/, "")
    .replace(/,\s*$/, "")
    // Strip hoyga only when detached at sentence end (no "iyo" list connector immediately before it)
    .replace(/\s+hoyga\s*\./gi, function(m, offset, str) {
      return /\biyo\s*$/.test(str.slice(0, offset)) ? m : ".";
    })
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Localized sentence renderer ──────────────────────────────────────────────
// Selects the per-lens, per-modal template from translations.json and fills
// {actor} and {action} from parse fields. Attempts dictionary translation of the
// action phrase; logs missing tokens via the returned missingTokens field.
// Returns { sentence, missingTokens } — never a bare string.

function renderLocalizedSentence(lens, modal, fields, lang) {
  const actor = fields.actor ? cleanActor(fields.actor) : null;
  const rawAction = cleanAction(fields.action);

  let action = rawAction;
  let missingTokens = null;

  if (rawAction && lang) {
    // Strip leading adverbs ("only", "also", "still", "just", "further") so that
    // "only be collected" reaches the passive pre-parser as "be collected" and
    // matches the dictionary entry. Verb/obj extraction also uses the stripped form.
    const actionForExtraction = rawAction.replace(/^(?:only|also|still|just|further)\s+/i, "");

    // Passive chain pre-parser: detect "be [past-participle] ..." and unify
    // into a single verb key — but only when that key exists in the dictionary.
    // Unknown passives route as individual tokens so "be" resolves via its own
    // entry (ser/быть/бути) rather than falling through to English.
    const passiveMatch = /^be\s+(\w+(?:ed|en|[dt]|n))\b\s*(.*)?$/i.exec(actionForExtraction);
    const passiveKey = passiveMatch ? `be ${passiveMatch[1].toLowerCase()}` : null;

    let verb, obj;
    if (passiveKey && DICTIONARY.verbs?.[passiveKey]) {
      verb = passiveKey;
      obj = null; // passive dict entry is the complete translation — remainder is English context, not a translatable object
    } else {
      const spaceIdx = actionForExtraction.indexOf(" ");
      // Strip trailing punctuation from the verb token — bill text often has
      // "manufacture, sell, offer..." where the comma attaches to the first word.
      const verbRaw = spaceIdx < 0 ? actionForExtraction : actionForExtraction.slice(0, spaceIdx);
      verb = verbRaw.toLowerCase().replace(/[.,;:!?]+$/, "");
      obj = spaceIdx < 0 ? null : actionForExtraction.slice(spaceIdx + 1).trim() || null;
    }

    const result = translateActionPhrase(verb, obj, lang);
    if (result.translated) {
      action = result.translated;
      // Object fell back to English — mark as partially localized so [!] shows.
      if (result.objMissing) {
        missingTokens = { verb, object: obj, raw: rawAction };
      }
    } else {
      // Verb not in dictionary. Behavior is gated on the language's word-order frame.
      //
      // SVO (frame[0] === "verb" — es, vi, ru, uk, tl, and the default):
      // Keep the English verb in place, translate the object if possible, and
      // continue with the localized modal/actor frame. One unknown word stays
      // English; the sentence structure and meaning are still delivered.
      //
      // SOV / verb-final (frame[0] === "object" — ko, so):
      // Fall back to the full English template. An English verb token in the
      // sentence-final slot is syntactically incoherent in these languages and
      // is worse than a clean English sentence.
      missingTokens = { verb, object: obj, raw: rawAction };
      const frame = DICTIONARY.syntax_frames?.[lang] || ["verb", "object"];
      if (frame[0] === "verb") {
        const objTrans = obj ? DICTIONARY.objects?.[obj.toLowerCase()]?.[lang] ?? null : null;
        const objOut = objTrans ? lcFirst(objTrans) : (obj ?? null);
        action = objOut ? `${verb} ${objOut}` : verb;
        // execution continues to subKey / template fill below
      } else {
        const englishRaw = TEMPLATES[lens]?.(fields) ?? null;
        return { sentence: finalize(englishRaw) || null, missingTokens };
      }
    }

    // Double-negation guard: two paths.
    //
    // Path A (explicit flag): the dictionary entry has inherent_negation: true —
    // the translated phrase already carries its own negation (e.g. "no se cobrará").
    // Switch the modal frame to "must" so the prohibition template's "no/не/không"
    // is not stacked on top. The verb phrase's own negation stands.
    //
    // Path B (runtime check): translated action happens to start with the
    // language's negation prefix (covers un-/non- adjectives like "no autorizado").
    // Strip the prefix so "no puede no autorizado" collapses to "no puede autorizado".
    if (modal === "cannot") {
      if (result.inherentNeg) {
        modal = "must"; // verb phrase carries negation — use non-negating frame
      } else {
        const NEG = { es: "no ", vi: "không ", ru: "не ", uk: "не " };
        const pfx = NEG[lang];
        if (pfx && action.toLowerCase().startsWith(pfx)) {
          action = action.slice(pfx.length).trim();
        }
      }
    }
  }

  if (modal === "cannot" && (lang === "uk" || lang === "ru") && rawAction) {
    const FEE_RE = /\b(fee|charge|payment|remuneration|compensation)\b/i;
    const isFee = FEE_RE.test(rawAction);
    let tmpl;
    if (lang === "uk") {
      tmpl = isFee
        ? "з {actor} не справляється {action}"
        : "{actor} не має права {action}";
    } else {
      tmpl = isFee
        ? "с {actor} не взимается {action}"
        : "{actor} не вправе {action}";
    }
    return {
      sentence: finalize(fillTemplate(tmpl, { actor: actor ?? "[?]", action: action ?? "[?]" })),
      missingTokens,
    };
  }

  let subKey;
  if (lens === "obligation_removal" || lens === "actor_power_shift") {
    subKey = action ? "with_action" : "no_action";
  } else if (lens === "scope_change" || lens === "threshold_shift" || lens === "action_domain_shift") {
    subKey = actor ? modal : "no_actor";
  } else {
    subKey = actor
      ? modal
      : modal === "must" ? "requires" : modal === "may" ? "allows" : "prohibits";
  }

  const tmpl = TRANSLATIONS[lens]?.[subKey]?.[lang];
  if (!tmpl) return { sentence: null, missingTokens };

  return {
    sentence: finalize(fillTemplate(tmpl, {
      actor: actor ?? "[?]",
      action: action ?? "[?]",
    })),
    missingTokens,
  };
}

// ─── Compound modal splitter ──────────────────────────────────────────────────
// Detects "and [modal]" boundaries where a single extracted action string
// encodes two independent obligation clauses (e.g. "cannot be charged any fee
// and must be compensated"). Returns the split point so each clause can be
// rendered with its own modal and dictionary lookup, or null if no split found.

function splitCompoundAction(actionStr) {
  if (!actionStr) return null;
  // Test multi-word modals before single-word to avoid partial matches
  const m = /\band\s+(must\s+not|shall\s+not|may\s+not|cannot|must|shall|may|will)\b/i.exec(actionStr);
  if (!m) return null;
  return {
    action1: actionStr.slice(0, m.index).trimEnd(),
    newModalStr: m[1].replace(/\s+/g, " ").toLowerCase(),
    action2: actionStr.slice(m.index + m[0].length).trimStart(),
  };
}

// ─── Render one ISC unit ──────────────────────────────────────────────────────

export function renderUnit(unit, lang) {
  const parse = unit.parse || {};
  const signal = unit.tetherAnchor?.matchedSignals?.[0] || "obligation";
  const sectionType = unit.sectionType || { type: "standard" };
  const modal = modalVerb(parse.who?.modal, signal);

  const fields = {
    actor: parse.who?.responsibleParty || null,
    modal,
    rawModal: parse.who?.modal || "",
    action: parse.what?.action || null,
    conditions: (parse.what?.conditions || []).filter((c) => c != null && c.length > 4),
    deadlines: (parse.when?.deadlines || []).filter((d) => d != null && d.length > 4),
    enforcement: parse.how?.enforcement || null,
  };

  let lens;
  let sentence;
  let missingTokens = null;

  if (sectionType.type === "repeal") {
    lens = "repeal";
    if (lang && lang !== "en") {
      const tmpl = TRANSLATIONS.repeal?.[lang];
      if (tmpl) {
        const actorText = fields.actor ? cleanActor(fields.actor) : "This section";
        sentence = finalize(fillTemplate(tmpl, { actor: actorText }));
      }
    }
    if (!sentence) {
      const actorText = fields.actor ? cleanActor(fields.actor) : "This section";
      const copula = /\b(sections|are)\b/i.test(actorText) ? "are" : "is";
      sentence = finalize(`${actorText} ${copula} no longer in effect`);
    }
  } else if (sectionType.type === "appropriation") {
    lens = "appropriation";
    const anchorText = unit.tetherAnchor?.anchorText || "";
    // End on a digit so trailing commas in "the sum of $5,000,000, or..." aren't captured
    const amountMatch = anchorText.match(/\$[\d,]*\d(?:\.\d{2})?/);
    const amount = amountMatch ? amountMatch[0] : null;
    // Prefer "for the purposes of X" over the first generic "for" clause
    const purposeMatch =
      anchorText.match(/\bfor\s+(?:the\s+)?purposes?\s+of\s+([^,;.]{4,60})/i) ||
      anchorText.match(/\bfor\s+(?:the\s+)?(?!biennium|expenditure|purposes?)([^,;.]{4,60})/i);
    const purpose = purposeMatch ? purposeMatch[1].trim() : null;
    // Capture the full entity name; stop before " for", comma, semicolon, or period
    const deptMatch = anchorText.match(
      /\bto\s+((?:the\s+)?(?:department|agency|office|board|commission)\s+of\s+[^,;.]{4,40}?)(?:\s+for\b|,|;|\.)/i
    );
    const recipient = deptMatch ? deptMatch[1].trim() : null;

    if (lang && lang !== "en") {
      const t = TRANSLATIONS.appropriation;
      if (amount && t) {
        const tmpl = (recipient || purpose) ? t.full?.[lang] : null;
        if (tmpl) {
          sentence = finalize(fillTemplate(tmpl, { amount, recipient: recipient || "", purpose: purpose || "" }));
        } else if (t.fallback?.[lang]) {
          sentence = finalize(t.fallback[lang]);
        }
      } else if (t?.fallback?.[lang]) {
        sentence = finalize(t.fallback[lang]);
      }
    }

    if (!sentence) {
      const core = amount
        ? `${amount} is allocated${recipient ? ` to ${recipient}` : ""}${purpose ? ` for ${purpose}` : ""}`
        : fields.action ? `Funding is appropriated ${cleanAction(fields.action)}` : "Funding is appropriated for this purpose";
      sentence = finalize(core);
    }
  } else {
    lens = classifyLens(unit);
    const split = splitCompoundAction(fields.action);

    if (split) {
      const modal2 = modalVerb(split.newModalStr, null);
      const fields1 = { ...fields, action: split.action1 };
      const fields2 = { ...fields, action: split.action2, modal: modal2, rawModal: split.newModalStr };

      const renderClause = (f) => {
        if (lang && lang !== "en") {
          return renderLocalizedSentence(lens, f.modal, f, lang);
        }
        const raw = TEMPLATES[lens]?.(f) ?? null;
        return { sentence: finalize(raw) || null, missingTokens: null };
      };

      const r1 = renderClause(fields1);
      const r2 = renderClause(fields2);
      const parts = [r1.sentence, r2.sentence].filter(Boolean);
      sentence = parts.length ? parts.join("\n\n") : null;
      missingTokens = r1.missingTokens || r2.missingTokens;
    } else if (lang && lang !== "en") {
      const result = renderLocalizedSentence(lens, modal, fields, lang);
      sentence = result.sentence;
      missingTokens = result.missingTokens;
    } else {
      const raw = TEMPLATES[lens]?.(fields) ?? null;
      sentence = finalize(raw) || plainify(unit.tetherAnchor?.anchorText);
    }
  }

  if (lang === "so" && sentence) {
    // Split on clause separator to sanitize each clause independently —
    // sanitizeSomaliOutput collapses \s+ which would destroy \n\n joins.
    // finalize runs first so it can append the period; sanitize then sees the
    // final punctuation and can strip any comma that precedes it.
    sentence = sentence.split("\n\n").map(s => sanitizeSomaliOutput(finalize(s))).join("\n\n");
  }

  if (lang === "ko" && sentence) {
    sentence = sentence.split("\n\n").map(s => sanitizeKoreanOutput(s)).join("\n\n");
  }

  return {
    sourceLocation: unit.tetherAnchor?.sourceLocation || "unknown",
    lens,
    signal,
    sectionType: sectionType.type,
    sentence,
    missingSignals: unit.missingSignals || [],
    controlFlags: unit.controlFlags || [],
    status: unit.status || "ok",
    missingTokens: missingTokens || null,
    isLocalized: missingTokens === null,
  };
}

// ─── Render full ISC output → plain meaning ───────────────────────────────────

export function renderISC(iscOutput, options = {}) {
  const lang = options.lang || null;
  const units = Array.isArray(iscOutput)
    ? iscOutput
    : iscOutput?.units || [];

  const seen = new Set();
  const rendered = units.map((u) => renderUnit(u, lang)).filter((r) => {
    if (!r.sentence) return false;
    if (seen.has(r.sentence)) return false;
    seen.add(r.sentence);
    return true;
  });

  // Determine section type from the first tagged unit — all units in one section share the same type
  const st = units.find((u) => u.sectionType?.type && u.sectionType.type !== "standard")?.sectionType
    || { type: "standard" };

  // Section type prefix applied once to the combined output — not repeated per sentence
  const tp = lang && lang !== "en" ? TRANSLATIONS.section_type_prefixes : null;
  const prefixMap = {
    addition:     tp?.addition?.[lang]     || "New law — ",
    amendment:    tp?.amendment?.[lang]    || "Amends existing law — ",
    appropriation: tp?.appropriation?.[lang] || "Funding — ",
    delayed: !st.effectiveDate ? "" : tp?.delayed?.[lang] ? fillTemplate(tp.delayed[lang], { date: st.effectiveDate }) : `Effective ${st.effectiveDate} — `,
    repeal: "",   // repeal sentences already read "is no longer in effect"
    standard: "",
  };
  const prefix = prefixMap[st.type] ?? "";

  const noObligationMsg = lang && lang !== "en"
    ? (TRANSLATIONS.no_obligation?.[lang] || "No obligation or change detected in this section.")
    : "No obligation or change detected in this section.";

  const repealMsg = lang && lang !== "en" && TRANSLATIONS.repeal?.[lang]
    ? finalize(fillTemplate(TRANSLATIONS.repeal[lang], { actor: "This section" }))
    : "This section is repealed and no longer in effect.";
  const body =
    rendered.length > 0
      ? rendered.map((r) => r.sentence).join("\n\n")
      : st.type === "repeal"
      ? repealMsg
      : noObligationMsg;

  return {
    plainMeaning: prefix ? `${prefix}${body}` : body,
    sentences: rendered,
    sectionType: st.type,
    hasContent: rendered.length > 0 || st.type === "repeal",
    isLocalized: rendered.every(r => r.isLocalized),
  };
}

