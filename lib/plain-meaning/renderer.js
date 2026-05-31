/**
 * Template Renderer — ISC output → plain language sentences
 *
 * One template per scope lens. All deterministic, no AI.
 *
 * Scope lenses (from meaning-buddy taxonomy):
 *   modality_shift      — obligation vs discretionary language
 *   actor_power_shift   — authority / delegation / responsibility
 *   scope_change        — coverage quantifiers (all / every / each / none)
 *   threshold_shift     — numeric standards, deadlines, percentages
 *   action_domain_shift — specific action verbs (inspect / audit / certify)
 *   obligation_removal  — negation of a previously stated requirement
 */

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
    re: /\b(all|every|each|any|none|no fewer than|throughout|entire|across all|all covered)\b/i,
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
  if (s.length > 280) s = `${s.slice(0, 277).trimEnd()}…`;
  return finalize(s);
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
    const subject = actor ? cleanActor(actor) : "This provision";
    const verb = actor
      ? modal
      : modal === "must"
      ? "requires"
      : modal === "may"
      ? "permits"
      : "prohibits";
    const act = cleanAction(action) || "comply with this requirement";

    let s = `${subject} ${verb} ${act}`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${dl}`;
    if (enforcement) s += `. Noncompliance: ${enforcement}`;
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
      : `${subject} holds authority under this provision`;
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
      : `${subject} applies to all covered persons or entities`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${dl}`;
    return s;
  },

  threshold_shift({ actor, modal, action, conditions, deadlines }) {
    if (!action) return null;
    const act = cleanAction(action);
    const isRounding = /\b(round(?:ed|ing)?|adjust(?:ed|ing|ment)?)\b/i.test(act || "");

    if (isRounding) {
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

    const subject = actor ? cleanActor(actor) : "This provision";
    const verb = actor ? modal : "requires";
    const threshold =
      firstDeadline(deadlines) ||
      (conditions || []).find((c) => /\d/.test(c)) ||
      firstCondition(conditions);

    let s = `${subject} ${verb} ${act}`;
    if (threshold && !alreadyPresent(s, threshold)) s += `, ${threshold}`;
    return s;
  },

  action_domain_shift({ actor, modal, action, conditions, deadlines }) {
    if (!action) return null;
    const subject = actor ? cleanActor(actor) : "This provision";
    const verb = actor ? modal : "requires";
    const act = cleanAction(action);

    let s = `${subject} ${verb} ${act}`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${cond}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${dl}`;
    return s;
  },

  obligation_removal({ actor, action, conditions, deadlines, rawModal }) {
    const subject = actor ? cleanActor(actor) : "This provision";
    const act = cleanAction(action);
    const copula = /\bare\b/i.test(rawModal || "") ? "are" : "is";

    let s = act
      ? `${subject} ${copula} no longer required to ${act}`
      : `${subject} removes a previously stated obligation`;

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

// ─── Render one ISC unit ──────────────────────────────────────────────────────

export function renderUnit(unit) {
  const parse = unit.parse || {};
  const signal = unit.tetherAnchor?.matchedSignals?.[0] || "obligation";
  const sectionType = unit.sectionType || { type: "standard" };
  const modal = modalVerb(parse.who?.modal, signal);

  const fields = {
    actor: parse.who?.responsibleParty || (parse.who?.actors || [])[0] || null,
    modal,
    rawModal: parse.who?.modal || "",
    action: parse.what?.action || null,
    conditions: (parse.what?.conditions || []).filter((c) => c.length > 4),
    deadlines: (parse.when?.deadlines || []).filter((d) => d.length > 4),
    triggers: (parse.when?.triggers || []).filter((t) => t.length > 4),
    mechanism: parse.how?.mechanism || null,
    enforcement: parse.how?.enforcement || null,
  };

  let lens;
  let sentence;

  if (sectionType.type === "repeal") {
    lens = "obligation_removal";
    const actorText = fields.actor ? cleanActor(fields.actor) : "This section";
    const copula = /\b(sections|are)\b/i.test(actorText) ? "are" : "is";
    sentence = finalize(`${actorText} ${copula} no longer in effect`);
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
    const deptMatch = anchorText.match(/\bto\s+(?:the\s+)?(?:department|agency|office|board|commission)\s+of\s+([^,;.]{4,40})/i);
    const recipient = deptMatch ? `the department of ${deptMatch[1].trim()}` : null;
    const core = amount
      ? `${amount} is allocated${recipient ? ` to ${recipient}` : ""}${purpose ? ` for ${purpose}` : ""}`
      : fields.action ? `Funding is appropriated ${cleanAction(fields.action)}` : "Funding is appropriated for this purpose";
    sentence = finalize(core);
  } else {
    lens = classifyLens(unit);
    const raw = TEMPLATES[lens]?.(fields) ?? null;
    sentence = finalize(raw) || plainify(unit.tetherAnchor?.anchorText);
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
  };
}

// ─── Render full ISC output → plain meaning ───────────────────────────────────

export function renderISC(iscOutput) {
  const units = Array.isArray(iscOutput)
    ? iscOutput
    : iscOutput?.units || [];

  const rendered = units.map(renderUnit).filter((r) => r.sentence);

  // Determine section type from the first tagged unit — all units in one section share the same type
  const st = units.find((u) => u.sectionType?.type && u.sectionType.type !== "standard")?.sectionType
    || { type: "standard" };

  // Section type prefix applied once to the combined output — not repeated per sentence
  const prefixMap = {
    addition: "New law — ",
    amendment: "Amends existing law — ",
    appropriation: "Funding — ",
    delayed: st.effectiveDate ? `Effective ${st.effectiveDate} — ` : "",
    repeal: "",   // repeal sentences already read "is no longer in effect"
    standard: "",
  };
  const prefix = prefixMap[st.type] ?? "";

  const body =
    rendered.length > 0
      ? rendered.map((r) => r.sentence).join(" ")
      : st.type === "repeal"
      ? "This section is repealed and no longer in effect."
      : "No obligation or change detected in this section.";

  return {
    plainMeaning: prefix ? `${prefix}${body}` : body,
    sentences: rendered,
    sectionType: st.type,
  };
}
