import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  // Strip temporal phrases already captured in TPS so we don't duplicate
  return action
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
  const verbTrans = DICTIONARY.verbs?.[verb]?.[lang] ?? null;
  const objTrans = obj ? DICTIONARY.objects?.[obj.toLowerCase()]?.[lang] ?? null : null;

  const verbMissing = !verbTrans;
  const objMissing = obj ? !objTrans : false;

  if (verbMissing || objMissing) {
    return { translated: null, verbMissing, objMissing };
  }

  const frame = DICTIONARY.syntax_frames?.[lang] || ["verb", "object"];
  const parts = frame
    .map(s => (s === "verb" ? verbTrans : s === "object" ? objTrans : null))
    .filter(Boolean);

  return { translated: parts.join(" ").trim() || null, verbMissing: false, objMissing: false };
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
    const spaceIdx = rawAction.indexOf(" ");
    const verb = spaceIdx < 0 ? rawAction.toLowerCase() : rawAction.slice(0, spaceIdx).toLowerCase();
    const obj = spaceIdx < 0 ? null : rawAction.slice(spaceIdx + 1).trim() || null;

    const result = translateActionPhrase(verb, obj, lang);
    if (result.translated) {
      action = result.translated;
    } else {
      missingTokens = { verb, object: obj, raw: rawAction };
    }
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
    if (lang && lang !== "en") {
      const result = renderLocalizedSentence(lens, modal, fields, lang);
      sentence = result.sentence;
      missingTokens = result.missingTokens;
    } else {
      const raw = TEMPLATES[lens]?.(fields) ?? null;
      sentence = finalize(raw) || plainify(unit.tetherAnchor?.anchorText);
    }
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

