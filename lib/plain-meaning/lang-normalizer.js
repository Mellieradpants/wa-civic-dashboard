// Pre-processing layer: normalizes text tokens by language-specific grammatical
// rules before dictionary lookup. Returns a normalized root form ready for lookup,
// plus detected modal intent and a restricted flag.
//
// No AI. No external services. All rules are static and deterministic.
// Every match is traceable to a named rule in each schema.
//
// Integration point: call normalize(token, lang) before dictionary lookup.
// Use the returned root as the lookup key. Fall back to the original token if
// the normalized root also misses — missing-token logging is unchanged.

// ─── Schema 1: Vietnamese ─────────────────────────────────────────────────────
// Word order: S-V-O. No index shuffling needed.
// Modifiers follow nouns — boundary expansion is handled downstream.
// Words are static (no inflection) — verbatim string matches only.
// Pre-verb intent markers: sẽ, phải, đang → mandate.
// Negation: không or không được before the verb → restricted.

const VI_MANDATE = new Set(["sẽ", "phải", "đang"]);
const VI_NEGATION = new Set(["không", "được"]);

function normalizeVi(token) {
  const words = token.trim().split(/\s+/);
  let modal = "permitted";
  let restricted = false;

  if (words[0]?.toLowerCase() === "không") {
    restricted = true;
    modal = "restricted";
  }

  let i = 0;
  while (i < words.length) {
    const w = words[i].toLowerCase();
    if (VI_NEGATION.has(w)) { i++; continue; }
    if (VI_MANDATE.has(w)) { if (!restricted) modal = "mandate"; i++; continue; }
    break;
  }

  return { root: words.slice(i).join(" ").trim() || token, modal, restricted };
}

// ─── Schema 2: Spanish ────────────────────────────────────────────────────────
// Adjectives follow nouns. Adverbs (-mente) inject between helper and core verb
// — skip them to locate the verb payload.
// Plural cascade: strip trailing -s/-es from adjectives during mapping.
// Verb conjugation: map third-person forms back to infinitive before lookup.
// Negation: "no" within 2-word window before a mandate verb, or "prohib" root.

function deconjugateEs(verb) {
  const v = verb.toLowerCase();
  if (/[aei]r$/i.test(v)) return v;                     // already infinitive
  if (v.endsWith("an") && v.length > 4) return v.slice(0, -2) + "ar"; // 3p-pl -ar
  if (v.endsWith("en") && v.length > 4) return v.slice(0, -2) + "er"; // 3p-pl -er/-ir
  if (v.endsWith("a")  && v.length > 3) return v + "r"; // 3p-sg -ar: fabrica → fabricar
  if (v.endsWith("e")  && v.length > 3) return v + "r"; // 3p-sg -er: vende → vender
  return v;
}

function depluralizeEs(word) {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s"))  return w.slice(0, -1);
  return w;
}

function normalizeEs(token) {
  const words = token.trim().split(/\s+/);
  let modal = "permitted";
  let restricted = false;

  for (let j = 0; j < Math.min(3, words.length); j++) {
    const w = words[j].toLowerCase();
    if (w === "no")         { restricted = true; modal = "restricted"; }
    if (/^prohib/.test(w))  { restricted = true; modal = "restricted"; }
  }

  let verbIdx = 0;
  while (verbIdx < words.length && words[verbIdx].toLowerCase().endsWith("mente")) {
    verbIdx++;
  }

  const verb = deconjugateEs(words[verbIdx] || "");
  const rest  = words.slice(verbIdx + 1).map(depluralizeEs).join(" ");
  const root  = (verb + (rest ? " " + rest : "")).trim() || token;

  return { root, modal, restricted };
}

// ─── Schema 3: Russian / Ukrainian ───────────────────────────────────────────
// Free word order — scan globally, do not assume fixed index positions.
// Stem-based lookup: strip case/conjugation suffixes, match on root.
// Ukrainian phonetic variants: в/у and і/й/та treated as equivalent connectors.
// Negation: не, запрещено (ru) or заборонено (uk) anywhere in clause.

const RU_RESTRICTED = new Set(["не", "запрещено", "нельзя"]);
const UK_RESTRICTED = new Set(["не", "заборонено", "не можна"]);
const RU_SKIP = new Set(["и", "в", "у", "на", "с", "по", "за", "от", "из", "или"]);
const UK_SKIP = new Set(["та", "і", "й", "у", "в", "на", "з", "по", "за", "від", "або"]);

// Verb infinitive endings stripped first, then noun case suffixes.
const RU_UK_VERB_ENDS  = ["ться", "тися", "ть", "ти"];
const RU_UK_NOUN_ENDS  = ["ого", "ому", "ым", "им", "ой", "ій", "ам", "ах", "ов", "ей", "ем", "ую", "ою"];

function stemRuUk(word) {
  const w = word.toLowerCase();
  for (const s of RU_UK_VERB_ENDS) {
    if (w.endsWith(s) && w.length > s.length + 2) return w.slice(0, -s.length);
  }
  for (const s of RU_UK_NOUN_ENDS) {
    if (w.endsWith(s) && w.length > s.length + 2) return w.slice(0, -s.length);
  }
  return w;
}

function normalizeRuUk(token, lang) {
  const words = token.trim().split(/\s+/);
  const restrictedSet = lang === "uk" ? UK_RESTRICTED : RU_RESTRICTED;
  const skipSet       = lang === "uk" ? UK_SKIP : RU_SKIP;
  let modal = "permitted";
  let restricted = false;

  for (const w of words) {
    if (restrictedSet.has(w.toLowerCase())) { restricted = true; modal = "restricted"; }
  }

  const root = words
    .filter(w => !skipSet.has(w.toLowerCase()))
    .map(stemRuUk)
    .join(" ")
    .trim();

  return { root: root || token, modal, restricted };
}

// ─── Schema 4: Tagalog ────────────────────────────────────────────────────────
// Word order: V-S-O. Verb is always at index 0.
// ang tags the following noun as subject; ng tags the following noun as object.
// Reduplication: strip repeated leading syllable to recover dictionary root.
// Negation: hindi or bawal in first two token positions → restricted.

const TL_NEGATION = new Set(["hindi", "bawal"]);

function stripReducplication(verb) {
  if (verb.length <= 6) return verb;
  const v = verb.toLowerCase();
  for (let len = 2; len <= 3; len++) {
    const prefix = v.slice(0, len);
    if (v.slice(len).startsWith(prefix)) return v.slice(0, len) + v.slice(len * 2);
  }
  return v;
}

function normalizeTl(token) {
  const words = token.trim().split(/\s+/);
  let modal = "permitted";
  let restricted = false;
  let subject = null;
  let object  = null;

  if (words.slice(0, 2).some(w => TL_NEGATION.has(w.toLowerCase()))) {
    restricted = true;
    modal = "restricted";
  }

  for (let j = 0; j < words.length - 1; j++) {
    const w = words[j].toLowerCase();
    if (w === "ang") subject = words[j + 1];
    if (w === "ng")  object  = words[j + 1];
  }

  let verbIdx = 0;
  while (verbIdx < words.length && TL_NEGATION.has(words[verbIdx].toLowerCase())) verbIdx++;

  const root = stripReducplication(words[verbIdx] || token);
  return { root, modal, restricted, subject, object };
}

// ─── Schema 5: Somali / Korean ────────────────────────────────────────────────
// Word order: S-O-V. Hold evaluation state open until the final token.
// Korean: 은/는 tags subject, 을/를 tags object.
// Somali: strip gender-based definite article suffixes (-ga, -ka, -da, -ta).
// Negation: 금지 in final verb token (Korean), loo ma oggola anywhere (Somali).

const SOMALI_ARTICLES = ["ga", "ka", "da", "ta"];

function stripSomaliArticle(word) {
  if (word.length <= 3) return word;
  const w = word.toLowerCase();
  for (const suf of SOMALI_ARTICLES) {
    if (w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

// Normalize Korean conjugated verb to dictionary 다-form.
function normalizeKoreanVerb(verb) {
  if (verb.endsWith("합니다"))  return verb.slice(0, -3) + "하다";
  if (verb.endsWith("됩니다"))  return verb.slice(0, -3) + "되다";
  if (verb.endsWith("습니다"))  return verb.slice(0, -3) + "다";
  if (verb.endsWith("어요") || verb.endsWith("아요")) return verb.slice(0, -2) + "다";
  if (verb.endsWith("어")   || verb.endsWith("아"))   return verb.slice(0, -1) + "다";
  return verb;
}

function normalizeSoKo(token, lang) {
  const words = token.trim().split(/\s+/);
  let modal = "permitted";
  let restricted = false;
  let subject = null;
  let object  = null;

  if (lang === "ko") {
    for (const w of words) {
      if (/[은는]$/.test(w)) subject = w.replace(/[은는]$/, "");
      if (/[을를]$/.test(w)) object  = w.replace(/[을를]$/, "");
    }
    const last = words[words.length - 1] || "";
    if (/금지/.test(last)) { restricted = true; modal = "restricted"; }
    return { root: normalizeKoreanVerb(last), modal, restricted, subject, object };
  }

  // Somali
  if (/loo\s+ma\s+oggola/i.test(token)) { restricted = true; modal = "restricted"; }
  const normalized = words.map(stripSomaliArticle);
  return { root: normalized[normalized.length - 1] || token, modal, restricted };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function normalize(token, lang) {
  if (!token || !lang) return { root: token || "", modal: "permitted", restricted: false };
  const t = String(token);
  switch (lang) {
    case "vi": return normalizeVi(t);
    case "es": return normalizeEs(t);
    case "ru": return normalizeRuUk(t, "ru");
    case "uk": return normalizeRuUk(t, "uk");
    case "tl": return normalizeTl(t);
    case "so": return normalizeSoKo(t, "so");
    case "ko": return normalizeSoKo(t, "ko");
    default:   return { root: t, modal: "permitted", restricted: false };
  }
}
