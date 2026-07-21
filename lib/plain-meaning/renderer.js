import { TEMPLATES, cleanActor, cleanAction } from "./templates.js";

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

const COMPOUND_SPLIT_RE = /\band\s+(must\s+not|shall\s+not|may\s+not|cannot|must|shall|may)\b/i;

function splitCompoundAction(actionStr) {
  if (!actionStr) return null;
  // Test multi-word modals before single-word to avoid partial matches
  const m = COMPOUND_SPLIT_RE.exec(actionStr);
  if (!m) return null;
  return {
    action1: actionStr.slice(0, m.index).trimEnd(),
    newModalStr: m[1].replace(/\s+/g, " ").toLowerCase(),
    action2: actionStr.slice(m.index + m[0].length).trimStart(),
  };
}

// Same "and [modal]" boundary splitCompoundAction finds, but located in the
// UNTOUCHED sourceDerivedText rather than the already-stripped action string
// — inclusionLists[].start is only meaningful in that same untouched text's
// coordinates, so this is what lets a detected list be attributed to the
// correct clause instead of "last clause" or "sentence-level."
function findCompoundSplitOffset(sourceDerivedText) {
  if (!sourceDerivedText) return null;
  const m = COMPOUND_SPLIT_RE.exec(sourceDerivedText);
  return m ? m.index : null;
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

function clause2Fields(fields, split) {
  return {
    ...fields,
    action: split.action2,
    modal: modalVerb(split.newModalStr, null),
    rawModal: split.newModalStr,
    conditions: [],
    deadlines: [],
  };
}

// ─── Inclusion/exclusion list notes ──────────────────────────────────────────
// Surfaces each pipeline-detected including/excluding list as a plain-English
// note attached to the instruction. Only classifications carrying real list
// text (PARENTHETICAL/COLON_SUBLIST/COMMA_BOUNDED/SENTENCE_END) produce a
// note — REVERSED/NOT_A_LIST/NON_SENTENCE never have listText, so they never
// render one, consistent with those being recorded classifications only.

// Same filler-phrase set pipeline.js's detector absorbs into the list span —
// duplicated here (not imported) since stripping it for display is a
// presentation concern, separate from the boundary-finding it serves there.
const NOTE_FILLER_PHRASES = [
  "but not limited to",
  "but not confined to",
  "without limiting the scope hereof",
  "without limitation",
  "at a minimum",
  "at minimum",
  "among other things",
  "among others",
  "as appropriate",
  "if applicable",
];
// Strips the marker word (plus optional colon) and any stacked filler
// phrases from the front of listText, so a note starts at the first real
// list item — "Named examples: including but not limited to X" would
// otherwise leak the marker and filler into what's shown to readers.
const NOTE_LEAD_IN_RE = new RegExp(
  `^(?:including|excluding)\\s*:?\\s*(?:,?\\s*(?:${NOTE_FILLER_PHRASES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")})\\s*,?\\s*)*`,
  "i"
);

function buildInclusionNotes(inclusionLists) {
  if (!Array.isArray(inclusionLists)) return [];
  return inclusionLists
    // extracted === false means the fail-open invariant rolled back this
    // sentence's extraction (see pipeline.js), so the list stays fully
    // present in the action text — rendering a note too would duplicate it.
    // Missing entirely (units arriving via the API's `units` input path, or
    // pre-invariant callers) defaults to true, same as every other
    // additive tetherAnchor field.
    .filter((l) => l && l.listText && l.extracted !== false)
    .map((l) => {
      const label = l.classification === "REVERSED" || l.marker === "excluding"
        ? "Does not include"
        : "Named examples";
      const body = l.listText.trim().replace(NOTE_LEAD_IN_RE, "");
      return `${label}: ${body}`;
    });
}

function appendNotes(sentence, notes) {
  if (!sentence || notes.length === 0) return sentence;
  return [sentence, ...notes.map((n) => finalize(n))].join(" ");
}

// ─── Trace: connect a rendered unit back to its lineage chain ────────────────
// unit.lineage.sentence is this unit's own record in unit.lineage.section.records
// (see pipeline.js DESIGN.md "Meaning Lineage Schema"). Walking parentNodeId from
// that record up to the root (parentNodeId: null) reconstructs the section's
// preamble steps in order; the root record's text is the untouched input, so
// slicing it at the sentence record's position recovers the literal source span.
// units arriving via the API's `units` input path bypass runPipeline and may
// carry no lineage at all — that's a system boundary, so missing/malformed
// lineage returns null rather than throwing.
export function traceRenderUnit(unit) {
  const lineage = unit?.lineage;
  const sentenceRecord = lineage?.sentence;
  const records = lineage?.section?.records;
  if (!sentenceRecord || !Array.isArray(records)) return null;

  const byId = new Map(records.map((r) => [r.id, r]));
  if (!byId.has(sentenceRecord.id)) return null;

  const ancestry = [];
  let current = byId.get(sentenceRecord.id);
  while (current) {
    ancestry.push(current);
    current = current.parentNodeId !== null ? byId.get(current.parentNodeId) : null;
  }
  ancestry.reverse();

  // The L3 CFS record and the inclusion-list detection record are both
  // children of the sentence record, not ancestors — they're this unit's
  // terminal steps, so they're appended after the walk in layer order.
  const cfsRecord = records.find(
    (r) => r.producedBy === "L3 CFS" && r.parentNodeId === sentenceRecord.id
  );
  const inclusionRecord = records.find(
    (r) => r.producedBy === "inclusion_list_detect" && r.parentNodeId === sentenceRecord.id
  );
  const steps = [
    ...ancestry,
    ...(cfsRecord ? [cfsRecord] : []),
    ...(inclusionRecord ? [inclusionRecord] : []),
  ];

  const root = ancestry[0];
  const position = sentenceRecord.position;
  const text = position && root?.text != null ? root.text.slice(position[0], position[1]) : null;

  return {
    sourceSpan: {
      position,
      text,
      locateFailed: Boolean(sentenceRecord.locateFailed),
    },
    steps: steps.map((r) => ({
      producedBy: r.producedBy,
      rule: r.rule,
      matched: r.matched,
      text: r.text,
      position: r.position,
      ...(r.locateFailed ? { locateFailed: true } : {}),
    })),
  };
}

// ─── Render one ISC unit ──────────────────────────────────────────────────────

export function renderUnit(unit, { debug = false } = {}) {
  const parse = unit.parse || {};
  const signal = unit.tetherAnchor?.matchedSignals?.[0] || "obligation";
  const sectionType = unit.sectionType || { type: "standard" };
  const fields = extractFields(unit, signal);
  const inclusionLists = unit.tetherAnchor?.inclusionLists || [];

  let lens;
  let sentence;
  let debugFields = fields;
  let notes = [];

  if (sectionType.type === "repeal") {
    lens = "repeal";
    const actorText = fields.actor ? cleanActor(fields.actor) : "This section";
    const copula = /\b(sections|are)\b/i.test(actorText) ? "are" : "is";
    sentence = finalize(`${actorText} ${copula} no longer in effect`);
    notes = buildInclusionNotes(inclusionLists);
    sentence = appendNotes(sentence, notes);
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
    notes = buildInclusionNotes(inclusionLists);
    sentence = appendNotes(sentence, notes);
  } else {
    lens = classifyLens(unit);
    const split = splitCompoundAction(fields.action);

    if (split) {
      const fields1 = { ...fields, action: split.action1 };
      // Both clauses share one subject in the source sentence ("X must A and
      // must B") — clause 2 keeps the same actor instead of a placeholder so
      // it stays traceable to who the source names. Conditions/deadlines are
      // still dropped from clause 2 since clause 1 already carries those.
      const fields2 = clause2Fields(fields, split);

      const renderClause = (f) => {
        const raw = TEMPLATES[lens]?.(f) ?? null;
        return { sentence: finalize(raw) || null };
      };

      const r1 = renderClause(fields1);
      let r2 = renderClause(fields2);
      let fields2Final = fields2;
      if (!r2.sentence && fields.actor) {
        fields2Final = { ...fields2, actor: fields.actor };
        r2 = renderClause(fields2Final);
      }

      // Attribute each detected list to whichever clause's source span
      // contains its marker — not "last clause" or "sentence-level" — using
      // the same "and [modal]" boundary splitCompoundAction found, but
      // located in the untouched sourceDerivedText: inclusionLists[].start
      // is only meaningful in that text's coordinates, not the already-
      // stripped action string splitCompoundAction actually split on.
      const splitOffset = findCompoundSplitOffset(unit.tetherAnchor?.sourceDerivedText);
      const list1 = splitOffset === null
        ? inclusionLists
        : inclusionLists.filter((l) => l.start < splitOffset);
      const list2 = splitOffset === null
        ? []
        : inclusionLists.filter((l) => l.start >= splitOffset);
      const notes1 = buildInclusionNotes(list1);
      const notes2 = buildInclusionNotes(list2);
      notes = [...notes1, ...notes2];

      const parts = [];
      const partsFields = [];
      if (r1.sentence) {
        parts.push(appendNotes(r1.sentence, notes1));
        partsFields.push(fields1);
      }
      if (r2.sentence) {
        parts.push(appendNotes(r2.sentence, notes2));
        partsFields.push(fields2Final);
      }
      sentence = parts.length ? parts.join("\n\n") : null;
      debugFields = partsFields;
    } else {
      const raw = TEMPLATES[lens]?.(fields) ?? null;
      const templateSentence = finalize(raw);
      sentence = templateSentence || plainify(unit.tetherAnchor?.anchorText);
      if (!templateSentence && sentence) lens = "fallback";
      notes = buildInclusionNotes(inclusionLists);
      sentence = appendNotes(sentence, notes);
    }
  }

  return {
    sourceLocation: unit.tetherAnchor?.sourceLocation || "unknown",
    lens,
    anchorText: unit.tetherAnchor?.anchorText || null,
    signal,
    sectionType: sectionType.type,
    sentence,
    notes,
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
          trace: traceRenderUnit(unit),
        }
      : {}),
  };
}

// ─── Render full ISC output → plain meaning ───────────────────────────────────

export function renderISC(iscOutput, { debug = false } = {}) {
  const units = Array.isArray(iscOutput)
    ? iscOutput
    : iscOutput?.units || [];

  const seen = new Set();
  const rendered = units.map((u) => renderUnit(u, { debug })).filter((r) => {
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

