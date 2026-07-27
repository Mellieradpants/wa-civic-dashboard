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

// ─── Coordinate-clause splitter ────────────────────────────────────────────
// Detects duties joined by "and" where the second duty does not repeat its
// actor — "the office ... shall award grants ... and shall adopt rules" —
// and separates them so each renders as its own duty with its own force.
// Validated over four rounds against a 212-bill sample; the rule below is
// exactly what those rounds confirmed, no more.
//
// TRIGGER: "and" (optionally preceded by , or ;) immediately followed by
// shall/must/may (optionally followed by "not"), or by "cannot". "will" is
// never a trigger -- observed cases are ordinary future tense, not duties.
// "cannot" is not part of the validated rule but was already a supported
// second-clause modal before this change (see the pre-existing baseline
// test "The recipient cannot be charged any fee and must be compensated");
// keeping it costs nothing and avoids silently dropping that support.
//
// A sentence may contain more than one trigger (a chain); each is evaluated
// independently and a blocked trigger doesn't stop the scan -- text just
// keeps accumulating toward the next one.
const TRIGGER_RE = /([,;]\s*)?\band\b\s+(shall|must|may|cannot)\b(\s+not\b)?/gi;

function findTriggers(text) {
  return [...text.matchAll(TRIGGER_RE)].map((m) => ({
    index: m.index,
    endIndex: m.index + m[0].length,
    force: m[2].toLowerCase(),
    negation: m[2].toLowerCase() !== "cannot" && !!m[3],
  }));
}

// Mirrors isEffectivelyEmptyAction in pipeline.js (same fail-open invariant
// as the including/excluding list detector: preservation beats separation).
// Not imported -- that copy is scoped to the list-extraction rollback it
// serves there, and touching it is out of scope for this work.
const CONNECTIVE_WORDS = new Set([
  "and", "or", "but", "the", "a", "an", "to", "of", "in", "on", "for",
  "with", "by", "as", "at", "from", "this", "that", "it", "its",
  "be", "been", "is", "are", "was", "were",
]);

function isEffectivelyEmptyAction(action) {
  if (!action) return true;
  const stripped = action.replace(/[.,;:()\-–—]/g, " ").trim();
  if (!stripped) return true;
  const words = stripped.split(/\s+/).filter(Boolean);
  return words.every((w) => CONNECTIVE_WORDS.has(w.toLowerCase()));
}

const PARTICIPLE_IRREGULAR = new Set([
  "given", "shown", "taken", "made", "done", "known", "seen", "held", "kept",
  "sent", "built", "brought", "bought", "found", "paid", "said", "told",
  "sold", "begun", "broken", "chosen", "driven", "written", "spoken",
  "stolen", "worn", "torn", "grown", "thrown", "drawn", "flown", "set", "lost",
]);

function isParticiple(word) {
  const w = word.toLowerCase();
  return /ed$/.test(w) || PARTICIPLE_IRREGULAR.has(w);
}

// Describes something happening or being the case rather than someone doing
// something. A passive second half ("must be collected", "may be seized")
// is never on this list -- it's performed by someone even when nobody is
// named, and is the largest group of genuine duties this rule recovers.
const NO_ACTOR_VERBS = new Set([
  "occur", "occurs", "exist", "exists", "happen", "happens", "remain",
  "remains", "continue", "continues", "lapse", "lapses", "expire", "expires",
  "consist", "consists", "apply", "applies", "differ", "differs", "arise",
  "arises", "result", "results",
]);

function firstWord(text) {
  const m = (text || "").trim().match(/^[a-zA-Z]+/);
  return m ? m[0].toLowerCase() : null;
}

// Classifies a second half's main verb. A bare "be" reached by looking
// through an infinitive ("continue to be employed") stays no_actor -- it is
// still describing an ongoing state, not a new action, so it does not get
// the top-level "be + participle is always passive" exception.
function classifySecondHalfVerb(text) {
  const words = text.trim().split(/\s+/);
  const w1 = firstWord(words[0] || "");
  if (!w1) return { type: "none" };

  if (w1 === "be") {
    const w2 = firstWord(words[1] || "");
    return w2 && isParticiple(w2) ? { type: "passive" } : { type: "active" };
  }
  if (NO_ACTOR_VERBS.has(w1)) {
    const w2 = firstWord(words[1] || "");
    if (w2 === "to") {
      const w3 = firstWord(words[2] || "");
      if (w3 === "be") return { type: "no_actor" };
      if (w3 && !NO_ACTOR_VERBS.has(w3)) return { type: "active" };
    }
    return { type: "no_actor" };
  }
  return { type: "active" };
}

// The first half ends on a bare "to" (with or without a trailing comma) --
// the words after the second half's requirement word belong to BOTH halves
// ("is not authorized to, and may not, supervise..."), so splitting would
// strand the first half unfinished.
function endsWithBareTo(text) {
  return /,?\s*to\s*$/i.test(text);
}

// The three conditions that block a split, applied to one trigger. beforeText
// is always measured from the start of the text being scanned, not just
// since the previous split -- testing only since the last split breaks
// chains, since a stacked third instruction's own local segment carries no
// requirement word of its own (it inherited one). endsWithBareTo only cares
// about the last few characters, so it gives the same answer either way;
// only the emptiness check actually depends on using the full span.
function evaluateTrigger(beforeText, afterText) {
  if (isEffectivelyEmptyAction(beforeText) || isEffectivelyEmptyAction(afterText)) {
    return { allowed: false };
  }
  if (endsWithBareTo(beforeText)) return { allowed: false };
  if (classifySecondHalfVerb(afterText).type === "no_actor") return { allowed: false };
  return { allowed: true };
}

// Splits text at every trigger that passes evaluateTrigger, carrying
// initialForce as the first clause's own force (the modal already known to
// govern it) and each later clause's force from the trigger that produced
// it. Returns null when no trigger in the text is actually allowed to split
// — the whole point of the gates is that finding a trigger doesn't mean
// splitting there is correct.
function splitIntoClauses(text, initialForce) {
  const triggers = findTriggers(text);
  if (!triggers.length) return null;

  const clauses = [];
  let currentStart = 0;
  let pendingForce = initialForce;
  let anySplit = false;

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    const beforeFromStart = text.slice(0, trigger.index).trim();
    const nextBoundary = i + 1 < triggers.length ? triggers[i + 1].index : text.length;
    const after = text.slice(trigger.endIndex, nextBoundary).trim();

    if (!evaluateTrigger(beforeFromStart, after).allowed) continue;

    const localText = text.slice(currentStart, trigger.index).trim();
    clauses.push({ text: localText, force: pendingForce.force, negation: pendingForce.negation });
    currentStart = trigger.endIndex;
    pendingForce = { force: trigger.force, negation: trigger.negation };
    anySplit = true;
  }

  const finalText = text.slice(currentStart).trim();
  clauses.push({ text: finalText, force: pendingForce.force, negation: pendingForce.negation });
  return anySplit ? clauses : null;
}

function canonicalizeModal(modal) {
  const m = (modal || "").toLowerCase();
  if (m === "cannot") return { force: "cannot", negation: false };
  if (m.includes("not")) return { force: m.replace(/\s*not$/, "").trim() || "must", negation: true };
  if (m === "shall" || m === "must" || m === "may") return { force: m, negation: false };
  return { force: "must", negation: false }; // other MODAL_RE matches (is required to, etc.)
}

// L5 AAC finds the modal by taking everything before the FIRST modal in the
// sentence as the actor. When the true first clause has no requirement word
// of its own ("The tax rate is three percent ... and must be assessed on
// the seller"), that naive extraction swallows the whole status clause plus
// the "and" into the actor -- so an actor ending on a bare "and" is exactly
// the fingerprint of a force-less first half, never a real actor phrase.
function actorSwallowedStatus(actor) {
  return /\band$/i.test((actor || "").trim());
}

// Detection: finds every coordinate clause present, from the real sentence
// text when L5 AAC's own extraction swallowed a force-less status clause,
// or from the already-correctly-extracted action text otherwise. Returns
// null when nothing splits. Organization -- deciding that a force-less
// first half is a condition on the duty that follows rather than a peer
// item -- is the caller's job (see attachStatusPrefix below), not this
// function's: this only ever reports what it found.
function analyzeCoordinateSplit(fields, sourceDerivedText) {
  if (!actorSwallowedStatus(fields.actor)) {
    if (!fields.modal || !fields.action) return null;
    const clauses = splitIntoClauses(fields.action, canonicalizeModal(fields.rawModal || fields.modal));
    return clauses ? { statusText: null, clauses } : null;
  }

  if (!sourceDerivedText) return null;
  const triggers = findTriggers(sourceDerivedText);
  if (!triggers.length) return null;

  const firstTrigger = triggers[0];
  const statusCandidate = sourceDerivedText.slice(0, firstTrigger.index).trim();
  const nextBoundary = triggers.length > 1 ? triggers[1].index : sourceDerivedText.length;
  const afterFirst = sourceDerivedText.slice(firstTrigger.endIndex, nextBoundary).trim();
  if (!evaluateTrigger(statusCandidate, afterFirst).allowed) return null;

  const remainder = sourceDerivedText.slice(firstTrigger.endIndex);
  const initialForce = { force: firstTrigger.force, negation: firstTrigger.negation };
  const clauses = splitIntoClauses(remainder, initialForce)
    || [{ text: afterFirst, force: initialForce.force, negation: initialForce.negation }];
  return { statusText: statusCandidate, clauses };
}

function lowerFirstLetter(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// Organization: a half with no requirement word is presented as the status
// or condition the following duty applies under, never as its own duty --
// a reader must never see "you must do X" language for something that
// isn't an obligation. Framed as a leading "Because ..." clause rather than
// the trailing-comma style existing conditions use, since a bare status
// statement has no "if/when/unless" connector of its own to read naturally
// trailing a sentence.
function attachStatusPrefix(sentence, statusText) {
  if (!sentence || !statusText) return sentence;
  const status = cleanAction(statusText) || statusText.trim();
  if (!status) return sentence;
  const body = sentence.replace(/\.\s*$/, "");
  return finalize(`Because ${lowerFirstLetter(status)}, ${lowerFirstLetter(body)}`);
}

// A status half often already names the very thing the duty is about --
// "The tax is in addition to other taxes authorized by law" -> "The tax".
// When that subject can be pulled out cleanly, carrying it onto the duty
// ("The tax must be collected ...") reads as a complete sentence instead of
// a bare passive fragment ("must be collected ..."). "Cleanly" is deliberately
// narrow: the text up to the status's own first copula/linking verb, with no
// internal comma or semicolon (a comma there means a leading adverbial or
// subordinate clause got included, not a plain subject -- "Once filed, the
// exemption" is not one) and no more than MAX_STATUS_SUBJECT_WORDS words
// (mirrors pipeline.js's MAX_SECOND_ACTOR_WORDS convention for the same
// judgment call on a different candidate-actor span). Returns null rather
// than a guess when the shape doesn't fit -- the caller then keeps the
// existing "Because X, ..." attachment instead of a malformed subject.
//
// Pulling the subject out is not enough on its own: everything the status
// clause says AFTER that subject is dropped unless it's kept some other
// way, and most predicates say something real ("is not debatable", "is
// exempt from...", "is final and binding on the parties") -- a fact the
// reader needs, not filler. Carrying the subject is only safe to do without
// the "Because ..." wrapper when the predicate is a pure lead-in with no
// separate fact of its own; "is/are in addition to X" is the one shape
// validated against the corpus as exactly that (it relates the subject to
// other taxes/penalties/etc. without asserting anything new). Every other
// predicate shape bails here (returns null) so the caller falls back to
// attachStatusPrefix, which keeps the whole status clause -- subject and
// predicate both -- rather than silently losing what it said.
const STATUS_SUBJECT_VERB_RE = /\b(is|are|was|were|belongs?|remains?|stands?|qualifies|constitutes|means)\b/i;
const MAX_STATUS_SUBJECT_WORDS = 12;
const TRIVIAL_STATUS_PREDICATE_RE = /^(?:is|are)\s+in\s+addition\s+to\b/i;

function extractStatusSubject(statusText) {
  const m = (statusText || "").match(STATUS_SUBJECT_VERB_RE);
  if (!m) return null;
  const candidate = statusText.slice(0, m.index).trim();
  if (!candidate || /[,;:]/.test(candidate)) return null;
  if (candidate.split(/\s+/).length > MAX_STATUS_SUBJECT_WORDS) return null;
  const predicate = statusText.slice(m.index).trim();
  if (!TRIVIAL_STATUS_PREDICATE_RE.test(predicate)) return null;
  return candidate;
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
    const analysis = analyzeCoordinateSplit(fields, unit.tetherAnchor?.sourceDerivedText);

    if (analysis) {
      const { statusText, clauses } = analysis;
      // A status clause has no actor of its own anywhere in the sentence
      // (that's what makes it a status rather than a duty). When its own
      // subject can be pulled out cleanly ("The tax is in addition to ..."
      // -> "The tax"), that becomes the actor for every duty clause, so the
      // duty reads as a complete sentence instead of a bare passive
      // fragment ("must be collected ..."). When it can't be pulled out
      // cleanly, there is still no actor — attachStatusPrefix below is what
      // carries the status in that case instead. Every duty clause
      // otherwise keeps the sentence's one actor, inherited the same way
      // whether it's the first duty or a later one in a chain.
      const statusSubject = statusText ? extractStatusSubject(statusText) : null;
      const baseActor = statusText ? statusSubject : fields.actor;
      const attachStatusToFirst = Boolean(statusText) && !statusSubject;

      const renderClause = (f) => finalize(TEMPLATES[lens]?.(f) ?? null);

      const parts = [];
      const partsFields = [];
      clauses.forEach((c, i) => {
        const rawModal = c.negation
          ? (c.force === "cannot" ? "cannot" : `${c.force} not`)
          : c.force;
        const clauseFields = {
          ...fields,
          actor: baseActor,
          modal: modalVerb(rawModal, null),
          rawModal,
          action: c.text,
          // L6-L9 fields only ever describe the whole sentence and can't be
          // reliably attributed to one clause among several — same choice
          // already made for a detectSecondInstruction split.
          conditions: i === 0 ? fields.conditions : [],
          deadlines: i === 0 ? fields.deadlines : [],
        };
        // No actor-retry fallback here: when baseActor is null (no subject
        // could be extracted from a force-less status clause), fields.actor
        // is the garbage AAC swallowed into the actor slot (see
        // actorSwallowedStatus above), never a usable substitute — falling
        // back to it would render that garbage as if it were a real actor.
        let rendered = renderClause(clauseFields);
        if (i === 0 && attachStatusToFirst) rendered = attachStatusPrefix(rendered, statusText);
        if (rendered) {
          parts.push(rendered);
          partsFields.push(clauseFields);
        }
      });

      // Every detected list is attributed to the first duty clause — same
      // reasoning as a detectSecondInstruction split's second group getting
      // none: a list can't be reliably assigned among 3+ clauses either.
      notes = buildInclusionNotes(inclusionLists);
      if (notes.length && parts.length) parts[0] = appendNotes(parts[0], notes);

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

