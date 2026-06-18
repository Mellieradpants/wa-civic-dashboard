// ─── Scope lens classifier ────────────────────────────────────────────────────

const LENS_PATTERNS = [
  {
    lens: "obligation_removal",
    re: /\b(no longer required|not required|no obligation|(?:requirement|obligation|restriction|prohibition|fee)s?\s+(?:is|are|has been|have been|was|were)\s+(?:removed|waived|exempted|eliminated)|no longer\s+\w+)\b/i,
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

// Conditions and deadlines are matched from the start of the source sentence
// and retain their original capitalization (e.g. "If the parent..."). When
// appended mid-sentence after a comma, that capital letter reads as a typo.
function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
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
    if (cond && !alreadyPresent(s, cond)) s += `, ${lowerFirst(cond)}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${lowerFirst(dl)}`;
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

    if (!act) return null;
    let s = `${subject} is responsible for ${act}`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${lowerFirst(cond)}`;
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
    if (cond && !alreadyPresent(s, cond)) s += `, ${lowerFirst(cond)}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${lowerFirst(dl)}`;
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
    if (threshold && !alreadyPresent(s, threshold)) s += `, ${lowerFirst(threshold)}`;
    return s;
  },

  action_domain_shift({ actor, modal, action, conditions, deadlines }) {
    if (!action) return null;
    const subject = actor ? cleanActor(actor) : "This section";
    const verb = actor ? modal : "requires";
    const act = cleanAction(action);

    let s = actor ? `${subject} ${verb} ${act}` : `${subject} ${verb}: ${act}`;
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${lowerFirst(cond)}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${lowerFirst(dl)}`;
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
    if (threshold && !alreadyPresent(s, threshold)) s += `, ${lowerFirst(threshold)}`;

    // Append any non-numeric condition not already covered
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${lowerFirst(cond)}`;

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

// ─── Compound modal splitter ──────────────────────────────────────────────────
// Detects "and [modal]" boundaries where a single extracted action string
// encodes two independent obligation clauses (e.g. "cannot be charged any fee
// and must be compensated"). Returns the split point so each clause can be
// rendered with its own modal and dictionary lookup, or null if no split found.

function splitCompoundAction(actionStr) {
  if (!actionStr) return null;
  // Test multi-word modals before single-word to avoid partial matches
  const m = /\band\s+(must\s+not|shall\s+not|may\s+not|cannot|must|shall|may)\b/i.exec(actionStr);
  if (!m) return null;
  return {
    action1: actionStr.slice(0, m.index).trimEnd(),
    newModalStr: m[1].replace(/\s+/g, " ").toLowerCase(),
    action2: actionStr.slice(m.index + m[0].length).trimStart(),
  };
}

function extractFields(unit, signal) {
  const parse = unit.parse || {};
  const modal = modalVerb(parse.who?.modal, signal);
  return {
    actor: parse.who?.responsibleParty || null,
    modal,
    rawModal: parse.who?.modal || "",
    action: parse.what?.action || null,
    conditions: (parse.what?.conditions || []).filter((c) => c != null && c.length > 4),
    deadlines: (parse.when?.deadlines || []).filter((d) => d != null && d.length > 4),
    enforcement: parse.how?.enforcement || null,
  };
}

function bareClause2Fields(fields, split) {
  return {
    ...fields,
    action: split.action2,
    modal: modalVerb(split.newModalStr, null),
    rawModal: split.newModalStr,
    actor: null,
    conditions: [],
    deadlines: [],
  };
}

// Counts how many units in this section would render an identical clause-2
// paragraph if the actor is dropped, so renderUnit can keep the actor for any
// that collide instead of producing duplicate paragraphs.
function collectClause2Collisions(units) {
  const counts = new Map();
  for (const u of units) {
    const sectionType = u.sectionType || { type: "standard" };
    if (sectionType.type === "repeal" || sectionType.type === "appropriation") continue;
    const signal = u.tetherAnchor?.matchedSignals?.[0] || "obligation";
    const fields = extractFields(u, signal);
    const split = splitCompoundAction(fields.action);
    if (!split) continue;
    const lens = classifyLens(u);
    const sentence = finalize(TEMPLATES[lens]?.(bareClause2Fields(fields, split)) ?? null);
    if (!sentence) continue;
    counts.set(sentence, (counts.get(sentence) || 0) + 1);
  }
  return counts;
}

// ─── Render one ISC unit ──────────────────────────────────────────────────────

export function renderUnit(unit, { debug = false, clause2Counts = null } = {}) {
  const parse = unit.parse || {};
  const signal = unit.tetherAnchor?.matchedSignals?.[0] || "obligation";
  const sectionType = unit.sectionType || { type: "standard" };
  const fields = extractFields(unit, signal);

  let lens;
  let sentence;
  let debugFields = fields;

  if (sectionType.type === "repeal") {
    lens = "repeal";
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
    // Capture the full entity name; stop before " for", comma, semicolon, or period
    const deptMatch = anchorText.match(
      /\bto\s+((?:the\s+)?(?:department|agency|office|board|commission)\s+of\s+[^,;.]{4,40}?)(?:\s+for\b|,|;|\.)/i
    );
    const recipient = deptMatch ? deptMatch[1].trim() : null;

    const core = amount
      ? `${amount} is allocated${recipient ? ` to ${recipient}` : ""}${purpose ? ` for ${purpose}` : ""}`
      : fields.action ? `Funding is appropriated ${cleanAction(fields.action)}` : "Funding is appropriated for this purpose";
    sentence = finalize(core);
  } else {
    lens = classifyLens(unit);
    const split = splitCompoundAction(fields.action);

    if (split) {
      const fields1 = { ...fields, action: split.action1 };
      // Clause 1 already carries the actor/condition/deadline context — repeating it
      // here produced near-duplicate sentences, so clause 2 drops them by default.
      const fields2Bare = bareClause2Fields(fields, split);

      const renderClause = (f) => {
        const raw = TEMPLATES[lens]?.(f) ?? null;
        return { sentence: finalize(raw) || null };
      };

      const r1 = renderClause(fields1);
      let r2 = renderClause(fields2Bare);
      // Dropping the actor from clause 2 avoids echoing clause 1 — but if the bare
      // clause 2 is identical to another unit's bare clause 2 in this section, the
      // actor is the only thing that would distinguish them, so keep it instead.
      const collides = r2.sentence && (clause2Counts?.get(r2.sentence) || 0) > 1;
      let fields2 = fields2Bare;
      if (collides && fields.actor) {
        fields2 = { ...fields2Bare, actor: fields.actor };
        r2 = renderClause(fields2);
      }
      let fields2Final = fields2;
      if (!r2.sentence && fields.actor) {
        fields2Final = { ...fields2, actor: fields.actor };
        r2 = renderClause(fields2Final);
      }
      const parts = [];
      const partsFields = [];
      if (r1.sentence) {
        parts.push(r1.sentence);
        partsFields.push(fields1);
      }
      if (r2.sentence) {
        parts.push(r2.sentence);
        partsFields.push(fields2Final);
      }
      sentence = parts.length ? parts.join("\n\n") : null;
      debugFields = partsFields;
    } else {
      const raw = TEMPLATES[lens]?.(fields) ?? null;
      const templateSentence = finalize(raw);
      sentence = templateSentence || plainify(unit.tetherAnchor?.anchorText);
      if (!templateSentence && sentence) lens = "fallback";
    }
  }

  return {
    sourceLocation: unit.tetherAnchor?.sourceLocation || "unknown",
    lens,
    anchorText: unit.tetherAnchor?.anchorText || null,
    signal,
    sectionType: sectionType.type,
    sentence,
    missingSignals: unit.missingSignals || [],
    controlFlags: unit.controlFlags || [],
    status: unit.status || "ok",
    sourceAction: parse.what?.action || null,
    stage: "render",
    ...(debug
      ? {
          debug: Array.isArray(debugFields)
            ? debugFields.map((f) => ({ ...f, templateUsed: lens }))
            : { ...debugFields, templateUsed: lens },
        }
      : {}),
  };
}

// ─── Render full ISC output → plain meaning ───────────────────────────────────

export function renderISC(iscOutput, { debug = false } = {}) {
  const units = Array.isArray(iscOutput)
    ? iscOutput
    : iscOutput?.units || [];

  const clause2Counts = collectClause2Collisions(units);
  const seen = new Set();
  const rendered = units.map((u) => renderUnit(u, { debug, clause2Counts })).filter((r) => {
    if (!r.sentence) return false;
    if (seen.has(r.sentence)) return false;
    seen.add(r.sentence);
    return true;
  });

  // Determine section type from the first tagged unit — all units in one section share the same type
  const st = units.find((u) => u.sectionType?.type && u.sectionType.type !== "standard")?.sectionType
    || { type: "standard" };

  // Section type prefix applied once to the combined output — not repeated per sentence
  const prefixMap = {
    addition:     "New law — ",
    amendment:    "Amends existing law — ",
    appropriation: "Funding — ",
    delayed: !st.effectiveDate ? "" : `Effective ${st.effectiveDate} — `,
    repeal: "",   // repeal sentences already read "is no longer in effect"
    standard: "",
  };
  const prefix = prefixMap[st.type] ?? "";

  const noObligationMsg = "No obligation or change detected in this section.";

  const repealMsg = "This section is repealed and no longer in effect.";
  const body =
    rendered.length > 0
      ? rendered.map((r) => r.sentence).join("\n\n")
      : st.type === "repeal"
      ? repealMsg
      : noObligationMsg;

  const emptyReason =
    rendered.length > 0
      ? null
      : units.length === 0
      ? "no_units_supplied"
      : "all_units_dropped";

  return {
    plainMeaning: prefix ? `${prefix}${body}` : body,
    sentences: rendered,
    sectionType: st.type,
    hasContent: rendered.length > 0 || st.type === "repeal",
    emptyReason,
  };
}

