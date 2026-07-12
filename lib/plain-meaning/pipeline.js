/**
 * 10-Layer Plain Meaning Pipeline
 *
 * Deterministic, no AI. Each layer is a pure function.
 * Mirrors the TCS Python pipeline (traceability_parser.py et al.) in JavaScript.
 *
 * Layers:
 *   L1  5WIH   — who/what/when/where/why/how assembly
 *   L2  SSE    — source statement extraction (signal-anchored spans)
 *   L3  CFS    — constraint filter (block intent, emotion, narrative)
 *   L4  LNS    — language normalization
 *   L5  AAC    — actor-action-condition parsing
 *   L6  TPS    — temporal parsing (deadlines, triggers, sequence)
 *   L7  SJM    — system/jurisdiction mapping
 *   L8  MPS    — mechanism parsing (how + enforcement)
 *   L9  RDS    — risk decomposition (likelihood vs consequence)
 *   L10 ISC    — information set construction (assemble output)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGLISH_VERBS = new Set(JSON.parse(
  readFileSync(path.join(__dirname, "..", "english-verbs.json"), "utf8")
));

// ─── Meaning lineage tracking (see DESIGN.md "The Meaning Lineage Schema") ────
// A tracked string pairs every character with the index it occupies in
// sec.text, so any surviving span can report an exact [start, end] position
// even after upstream characters have been removed or replaced.

function trackedFromText(text) {
  const offsets = new Array(text.length);
  for (let i = 0; i < text.length; i++) offsets[i] = i;
  return { text, offsets };
}

// [start, end] only reproduces this record's text by direct slicing when
// originalText actually contains that exact text at that span. A contiguous
// offset run isn't enough to guarantee that — collapseRunsAndTrim can replace
// a single whitespace character with a literal " " at the same offset (e.g.
// a lone "\n" becomes " "), leaving the offsets contiguous while the
// character value still changed. Slicing originalText directly and comparing
// catches that case too, instead of only catching interior deletions.
function trackedSpan(tracked, originalText) {
  if (tracked.text.length === 0) return { position: [0, 0], locateFailed: false };
  const { offsets } = tracked;
  const position = [offsets[0], offsets[offsets.length - 1] + 1];
  const locateFailed = originalText.slice(position[0], position[1]) !== tracked.text;
  return { position, locateFailed };
}

// Record ids are sequential and unique within a chain — one chain per
// section, shared by the preamble records in chain.records and the
// sentence-split records in sentenceLineage (see runPipeline) — so a
// parentNodeId always resolves to a real record regardless of which list
// it lives in.
function nextNodeId(chain) {
  return chain.nextNodeId++;
}

// One record type, not a node/edge split — every snapshot of text already
// is the outcome of the step that produced it (see DESIGN.md "Record").
// The root record (sec.text itself) is the only one with parentNodeId: null.
function makeRecord(chain, { parentNodeId, text, producedBy, position, rule, matched, locateFailed }) {
  const record = { id: nextNodeId(chain), parentNodeId, text, producedBy, position, rule, matched };
  // Only attached when true, so every other record keeps its existing shape —
  // this marks a position that couldn't be verified, not a real [0, 0] match.
  if (locateFailed) record.locateFailed = true;
  chain.records.push(record);
  return record;
}

// Removes every match of a global regex entirely — for steps that delete
// text outright rather than collapse or relocate it.
function stripGlobal(tracked, regex) {
  const matches = [...tracked.text.matchAll(regex)];
  if (matches.length === 0) return { tracked, matched: false };
  let text = "";
  const offsets = [];
  let cursor = 0;
  for (const m of matches) {
    text += tracked.text.slice(cursor, m.index);
    offsets.push(...tracked.offsets.slice(cursor, m.index));
    cursor = m.index + m[0].length;
  }
  text += tracked.text.slice(cursor);
  offsets.push(...tracked.offsets.slice(cursor));
  return { tracked: { text, offsets }, matched: true };
}

// Removes a single ^-anchored prefix match.
function stripPrefix(tracked, regex) {
  const m = tracked.text.match(regex);
  if (!m) return { tracked, matched: false };
  const len = m[0].length;
  return {
    tracked: { text: tracked.text.slice(len), offsets: tracked.offsets.slice(len) },
    matched: true,
  };
}

// Collapses whitespace runs of at least minRunLength down to a single space,
// then trims both ends. Mirrors `.replace(/\s{n,}/g, " ").trim()` while
// keeping every surviving character's original offset attached.
function collapseRunsAndTrim(tracked, minRunLength) {
  const src = tracked.text;
  let text = "";
  const offsets = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j - i >= minRunLength) {
        text += " ";
        offsets.push(tracked.offsets[i]);
      } else {
        text += src.slice(i, j);
        for (let k = i; k < j; k++) offsets.push(tracked.offsets[k]);
      }
      i = j;
    } else {
      text += src[i];
      offsets.push(tracked.offsets[i]);
      i++;
    }
  }
  let start = 0;
  let end = text.length;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  const trimmedText = text.slice(start, end);
  const trimmedOffsets = offsets.slice(start, end);
  return { tracked: { text: trimmedText, offsets: trimmedOffsets }, matched: trimmedText !== src };
}

// Mid-text subsection markers are replaced with a single synthetic
// SUBSECTION_BREAK char (see splitSentences below). The preceding ". " is
// kept verbatim with its real offsets; only the marker itself collapses to
// one position, anchored where the marker started.
function stripMidSubsectionMarkers(tracked, regex) {
  const matches = [...tracked.text.matchAll(regex)];
  if (matches.length === 0) return { tracked, matched: false };
  let text = "";
  const offsets = [];
  let cursor = 0;
  for (const m of matches) {
    text += tracked.text.slice(cursor, m.index);
    offsets.push(...tracked.offsets.slice(cursor, m.index));
    const keep = m[1];
    text += keep;
    offsets.push(...tracked.offsets.slice(m.index, m.index + keep.length));
    text += SUBSECTION_BREAK;
    offsets.push(tracked.offsets[m.index + keep.length]);
    cursor = m.index + m[0].length;
  }
  text += tracked.text.slice(cursor);
  offsets.push(...tracked.offsets.slice(cursor));
  return { tracked: { text, offsets }, matched: true };
}

// Locates a sentence string (already trimmed/marker-stripped by
// splitSentences) back inside the tracked text it was split from, searching
// forward from searchFrom so repeated sentence text resolves in order.
function locateSentence(tracked, sentenceText, searchFrom) {
  const idx = tracked.text.indexOf(sentenceText, searchFrom);
  if (idx === -1) return null;
  return { start: idx, end: idx + sentenceText.length };
}

// Same problem as trackedSpan: a contiguous offset run doesn't guarantee
// originalText actually reproduces tracked.text at that span, since a single
// whitespace character can be value-substituted (e.g. "\n" -> " ") without
// breaking offset contiguity. Slicing originalText and comparing directly
// catches that case too, not just interior deletions.
function absolutePosition(tracked, start, end, originalText) {
  if (end <= start) {
    const p = tracked.offsets[start] ?? 0;
    return { position: [p, p], locateFailed: false };
  }
  const position = [tracked.offsets[start], tracked.offsets[end - 1] + 1];
  const locateFailed = originalText.slice(position[0], position[1]) !== tracked.text.slice(start, end);
  return { position, locateFailed };
}

// ─── L4: LNS — Language Normalization ────────────────────────────────────────

function normalize(text) {
  return String(text || "")
    .replace(/^\s*(?:NEW SECTION\.\s+)?Sec\.\s+\d+\.?\s*/i, "")
    .replace(/^\s*Section\s+\d+[.:)]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── L2: SSE — Source Statement Extraction ───────────────────────────────────

const PROHIBITION_RE =
  /\bmay not\b|\bmust not\b|\bshall not\b|\bcannot\b|\bis prohibited\b|\bare prohibited\b|\bprohibited from\b/i;
const OBLIGATION_RE =
  /\bshall\b|\bmust\b|\brequired to\b|\bis required\b|\bare required\b|\bobligated to\b|\bis responsible for\b|\bare responsible for\b|\bmust be rounded\b|\bmust be adjusted\b|\bshall be rounded\b|\bshall be adjusted\b|\bis repealed\b|\bare each repealed\b|\bis(?:\s+hereby)?\s+appropriated\b/i;
const PERMISSION_RE =
  /(?<!\bmay not\b.{0,20})\bmay\b(?!\s+not\b)|\bpermitted to\b|\bauthorized to\b|\bis allowed\b/i;

function detectSignal(text) {
  if (PROHIBITION_RE.test(text)) return "prohibition";
  if (OBLIGATION_RE.test(text)) return "obligation";
  if (PERMISSION_RE.test(text)) return "permission";
  return null;
}

const SIGNAL_RULE = {
  prohibition: "PROHIBITION_RE",
  obligation: "OBLIGATION_RE",
  permission: "PERMISSION_RE",
};

// A relative clause (which/that/who) can carry its own modal word, separate
// from and unrelated to the sentence's main clause — e.g. "...the commission
// may issue a license... provided that the applicant which shall substantially
// conform to RCW 43.03.150..." The "shall" belongs to the relative clause, not
// to "may issue"; detecting it as sentence-wide signal wrongly forces the main
// clause's own permission to render as an obligation. Only these three
// markers are handled — "if", "provided that", and other subordinate
// constructions are out of scope for this version.
const RELATIVE_MARKER_RE = /\b(which|that|who)\b/gi;
const CLAUSE_MODAL_RE = /\b(may|shall|must)\b/i;

// A clause's span runs from its marker through its own first modal word and
// whatever follows it, stopping at the next modal word after that (where the
// main clause's own instruction resumes) or at the end of the text if there
// isn't one. This boundary rule — not punctuation — is what keeps a genuine
// main-clause obligation ("who may be aggrieved shall file...") from getting
// swallowed into the relative clause: "shall" there is a second, later modal,
// so the clause span stops right before it.
function detectRelativeClauses(text) {
  const clauses = [];
  RELATIVE_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = RELATIVE_MARKER_RE.exec(text)) !== null) {
    const marker = m[0].toLowerCase();
    const afterMarker = text.slice(m.index + m[0].length);
    const ownModalMatch = CLAUSE_MODAL_RE.exec(afterMarker);
    if (!ownModalMatch) continue; // no modal in this clause — not a candidate

    const afterOwnModal = afterMarker.slice(ownModalMatch.index + ownModalMatch[0].length);
    const nextModalMatch = CLAUSE_MODAL_RE.exec(afterOwnModal);
    const clauseEndOffset = nextModalMatch
      ? ownModalMatch.index + ownModalMatch[0].length + nextModalMatch.index
      : afterMarker.length;

    const span = [m.index, m.index + m[0].length + clauseEndOffset];
    const clauseText = text.slice(span[0], span[1]).trim();
    clauses.push({ marker, clauseText, span, signal: detectSignal(clauseText) });
    RELATIVE_MARKER_RE.lastIndex = span[1];
  }
  return clauses;
}

// Replaces a single whole-sentence signal with a primary classification for
// the main clause plus a separate entry for each detected relative clause, so
// a relative clause's own modal word can no longer silently override the main
// clause's. primary is computed the same way detectSignal always was —
// PROHIBITION_RE, then OBLIGATION_RE, then PERMISSION_RE, first match wins —
// just scoped to the sentence text with every detected relative-clause span
// removed first.
function detectSignals(text) {
  const relativeClauses = detectRelativeClauses(text);
  let mainText = text;
  for (const clause of [...relativeClauses].sort((a, b) => b.span[0] - a.span[0])) {
    mainText = mainText.slice(0, clause.span[0]) + mainText.slice(clause.span[1]);
  }
  return {
    primary: detectSignal(mainText),
    additional: relativeClauses.map(({ marker, clauseText, signal }) => ({ marker, clauseText, signal })),
  };
}

// Marks a sentence boundary left behind by stripping a subsection marker
// (see runPipeline below) — splitSentences treats it as a guaranteed split
// point even when what follows isn't [A-Z("], without having to treat a
// digit/$/lowercase letter as a valid sentence start everywhere in general.
const SUBSECTION_BREAK = "\u0001";

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("\u0001])/)
    .map((s) => s.replace(/\u0001/g, "").trim())
    .filter((s) => s.length > 15);
}

// Splits via the unmodified splitSentences, then records one lineage record
// per candidate sentence carrying the L2 SSE signal-detection outcome —
// including sentences with no signal, which are dropped here and never reach
// buildUnit (see DESIGN.md "The Meaning Lineage Schema" — "checked, did not
// apply" must be recorded explicitly). Every record's parentNodeId is set to
// the same parentNodeId — the final preamble-chain record this section's
// sentences all branched from — which is exactly the branch point DESIGN.md
// describes, instead of that relationship being inferred from array order.
function extractSignalSentences(tracked, sentenceLineage, chain, parentNodeId, originalText) {
  const pieces = splitSentences(tracked.text);
  const out = [];
  let cursor = 0;
  for (const s of pieces) {
    const loc = locateSentence(tracked, s, cursor);
    // null means the sentence text couldn't be found back in tracked —
    // never fall back to [0, 0], which would look like a verified match
    // at the very start of the section.
    const located = loc ? absolutePosition(tracked, loc.start, loc.end, originalText) : null;
    if (loc) cursor = loc.end;

    const signals = detectSignals(s);
    const hasSignal = signals.primary !== null || signals.additional.length > 0;
    const rule = signals.primary
      ? SIGNAL_RULE[signals.primary]
      : signals.additional.length
      ? "signal_in_subordinate_clause_only"
      : "no_signal_matched";
    const record = makeRecord(chain, {
      parentNodeId,
      text: s,
      producedBy: "sentence_split",
      position: located ? located.position : null,
      rule,
      matched: hasSignal,
      locateFailed: !loc || located.locateFailed,
    });
    sentenceLineage.push(record);

    if (hasSignal) out.push({ text: s, signals, lineage: record });
  }
  return out;
}

// ─── L3: CFS — Constraint Filter ─────────────────────────────────────────────

const BLOCKED = [
  { re: /\bintends?\s+to\b/i, rule: "intends_to" },
  { re: /\bseeks?\s+to\b/i, rule: "seeks_to" },
  { re: /\baims?\s+to\b/i, rule: "aims_to" },
  { re: /\bdesigned\s+to\b/i, rule: "designed_to" },
  { re: /\bpurpose\s+is\s+to\b/i, rule: "purpose_is_to" },
];

function checkConstraintFilter(text) {
  for (const { re, rule } of BLOCKED) {
    if (re.test(text)) return { passed: false, rule };
  }
  return { passed: true, rule: null };
}

// ─── L5: AAC — Actor-Action-Condition Parsing ─────────────────────────────────

const MODAL_RE =
  /\b(is no longer required to|are no longer required to|is responsible for|are responsible for|are each repealed|is repealed|is(?:\s+hereby)?\s+appropriated|shall not|must not|may not|(?:is|are)\s+(?:\w+\s+)?obligated to|obligated to|shall|must|may|cannot|is required to|are required to)\b/i;

function parseActorActionCondition(text) {
  const norm = normalize(text);
  const modalMatch = norm.match(MODAL_RE);

  let actor = null;
  let modal = null;
  let action = null;

  if (modalMatch) {
    const idx = modalMatch.index;
    let rawActor = norm.slice(0, idx).replace(/,\s*$/, "").trim() || null;
    // Strip leading condition clause so "If X, the department" → "the department".
    // If the clause has no comma-separated tail, or the tail is a prepositional
    // fragment, return null rather than passing contaminated text as the actor.
    if (rawActor && /^(?:if|when|unless|until|except|provided\s+that|in\s+the\s+event)\b/i.test(rawActor)) {
      const lastCommaIdx = rawActor.lastIndexOf(",");
      const tail = lastCommaIdx >= 0 ? rawActor.slice(lastCommaIdx + 1).trim() : "";
      rawActor = (tail.length > 2 && !/^(?:in|on|at|by|for|with|through|via|pursuant|notwithstanding)\b/i.test(tail))
        ? tail : null;
    }
    actor = rawActor;
    modal = modalMatch[0].trim().toLowerCase();
    action = norm
      .slice(idx + modalMatch[0].length)
      .replace(/[.;]+$/, "")
      .trim() || null;

    if (/obligated to$/.test(modal)) {
      modal = "must";
      const firstWord = action ? action.split(/\s+/)[0].toLowerCase() : null;
      if (!(firstWord && ENGLISH_VERBS.has(firstWord))) {
        action = action ? `be obligated to ${action}` : "be obligated to it";
      }
    }
  }

  const conditions = [];
  const condPatterns = [
    /\bif\s+[^,;.]{4,}/gi,
    /\bwhen\s+[^,;.]{4,}/gi,
    /\bunless\s+[^,;.]{4,}/gi,
    /\bexcept\s+[^,;.]{4,}/gi,
    /\bprovided that\s+[^,;.]{4,}/gi,
    /\bsubject to\s+[^,;.]{4,}/gi,
    /\bupon\s+[^,;.]{4,}/gi,
    /\bonly if\s+[^,;.]{4,}/gi,
  ];
  for (const p of condPatterns) {
    for (const m of norm.matchAll(p)) {
      const c = m[0].trim();
      if (!conditions.includes(c)) conditions.push(c);
    }
  }

  return { actor, modal, action, conditions };
}

// ─── L6: TPS — Temporal Parsing ──────────────────────────────────────────────

function parseTemporalSignals(text) {
  const deadlines = [];
  const triggers = [];
  const sequence = [];

  const NUM = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety|one hundred)";
  const UNIT = "(?:business\\s+)?(?:days?|months?|years?|hours?|weeks?)";
  for (const m of text.matchAll(new RegExp(`within\\s+${NUM}\\s+${UNIT}`, "gi"))) {
    deadlines.push(m[0].trim());
  }
  for (const m of text.matchAll(/no later than\s+[^;.]{3,60}/gi)) {
    deadlines.push(m[0].trim());
  }
  for (const m of text.matchAll(
    /(?:upon|after|following|once)\s+[^,;.]{4,60}/gi
  )) {
    triggers.push(m[0].trim());
  }
  for (const m of text.matchAll(
    /(?:before|after|then|prior to|subsequent to)\s+[^,;.]{4,60}/gi
  )) {
    sequence.push(m[0].trim());
  }

  return { deadlines, triggers, sequence };
}

// ─── L7: SJM — System/Jurisdiction Mapping ───────────────────────────────────

function mapJurisdiction(text) {
  let jurisdiction = null;
  let system = null;
  let controllingEntity = null;

  if (/\b(rcw|revised code of washington|washington state|wa legislature)\b/i.test(text)) {
    jurisdiction = "Washington State";
    system = "wa_legislature";
  } else if (/\b(congress|federal|u\.s\.|cfr|u\.s\.c\.)\b/i.test(text)) {
    jurisdiction = "Federal";
    system = "federal_law";
  }

  const entityMatch = text.match(
    /\b(?:the\s+)?(?:department|agency|commission|board|office|secretary|director|officer|authority)\s+of\s+[A-Z][A-Za-z\s]{2,40}/
  );
  if (entityMatch) controllingEntity = entityMatch[0].trim();

  return { jurisdiction, system, controllingEntity };
}

// ─── L8: MPS — Mechanism Parsing ─────────────────────────────────────────────

function parseMechanism(text) {
  let mechanism = null;
  let enforcement = null;

  const mechMatch = text.match(
    /\b(?:by|through|via|using|pursuant to)\s+[^,;.]{4,80}/i
  );
  if (mechMatch) mechanism = mechMatch[0].trim();

  const enfMatch = text.match(
    /\b(?:penalty|fine|violation|failure to comply|subject to\s+(?:a\s+)?(?:fine|penalty)|enforcement)\b[^.;]*/i
  );
  if (enfMatch) enforcement = enfMatch[0].trim();

  return { mechanism, enforcement };
}

// ─── L9: RDS — Risk Decomposition ────────────────────────────────────────────

function decomposeRisk(text) {
  const likelihood = [];
  const consequences = [];

  for (const m of text.matchAll(
    /\b(?:may|might|could|likely|possible|probable)\b[^,;.]{0,60}/gi
  )) {
    likelihood.push(m[0].trim());
  }
  for (const m of text.matchAll(
    /\b(?:resulting? in|subject to|leading? to|cause[sd]?|consequence)\b[^,;.]{0,60}/gi
  )) {
    consequences.push(m[0].trim());
  }

  return { likelihood, consequences };
}

// ─── SSE pre-pass: section type classification ────────────────────────────────
// Runs on the full section text before signal extraction. Tags the section so
// every ISC unit produced from it knows whether it is new law, an amendment,
// a repeal, a delayed-effective provision, or an appropriation.

function detectSectionType(text) {
  if (/\bNEW\s+SECTION\b/i.test(text)) return { type: "addition" };
  if (/\bis\s+amended\s+to\s+read\s+as\s+follows\b/i.test(text)) return { type: "amendment" };
  if (/\b(?:are\s+each\s+repealed|is\s+repealed)\b/i.test(text)) return { type: "repeal" };
  const effM = text.match(
    /\b(?:effective|takes?\s+effect)\s+([^.;\n]{0,60}?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i
  );
  if (effM) {
    const date = effM[1].trim().replace(/\s+/g, " ");
    return { type: "delayed", effectiveDate: date.length > 40 ? `${date.slice(0, 40).trimEnd()}` : date };
  }
  if (/\bis\s+(?:hereby\s+)?appropriated\b|\bsum\s+of\s+\$/i.test(text)) return { type: "appropriation" };
  return { type: "standard" };
}

// ─── L1: 5WIH + L10: ISC — Assemble ─────────────────────────────────────────

function buildUnit(sentenceObj, sourceIndex, sectionType = { type: "standard" }, billId = null, chain = null) {
  const { text, signals, lineage } = sentenceObj;

  const cfs = checkConstraintFilter(text); // L3 CFS
  if (lineage && chain) {
    // L3 CFS doesn't transform text — it only filters — so the record it
    // produces carries the same text/position as the sentence record it's
    // parented to. matched: true means the BLOCKED pattern fired and this
    // sentence is dropped below.
    makeRecord(chain, {
      parentNodeId: lineage.id,
      text,
      producedBy: "L3 CFS",
      position: lineage.position,
      rule: cfs.rule,
      matched: !cfs.passed,
      locateFailed: lineage.locateFailed,
    });
  }
  if (!cfs.passed) return null;

  const norm = normalize(text); // L4 LNS
  const aac = parseActorActionCondition(norm); // L5 AAC
  const tps = parseTemporalSignals(text); // L6 TPS
  const sjm = mapJurisdiction(text); // L7 SJM
  const mps = parseMechanism(text); // L8 MPS
  const rds = decomposeRisk(text); // L9 RDS

  // L1 5WIH
  const wih = {
    what: {
      claim: text,
      action: aac.action,
      conditions: aac.conditions,
    },
    who: {
      responsibleParty: aac.actor,
      modal: aac.modal,
    },
    where: sjm,
    when: tps,
    why: { statedReason: null },
    how: {
      mechanism: mps.mechanism,
      enforcement: mps.enforcement,
    },
  };

  const missingSignals = [];
  if (wih.what.action && !wih.who.responsibleParty) {
    missingSignals.push("missing_actor");
  }
  // Scoped to the main clause's own signal only — a subordinate clause's
  // obligation (e.g. "which shall substantially conform to...") doesn't
  // trigger this check for the main clause. Extending missing_enforcement
  // to subordinate clauses is out of scope for this version.
  if (signals.primary === "obligation" && !wih.how.enforcement) {
    missingSignals.push("missing_enforcement");
  }

  const traceReason = signals.primary
    ? `Matched ${signals.primary} signal language in source text`
    : `Matched ${signals.additional[0]?.signal} signal only in a subordinate clause`;

  // L10 ISC
  return {
    sectionType,
    tetherAnchor: {
      type: "text_span",
      sourceSystem: "plain_meaning_pipeline",
      sourceLocation: `sentence_${sourceIndex + 1}`,
      anchorText: text,
      sourceDerivedText: norm,
      // Unchanged shape from before this change: zero or one string, element
      // 0 the main clause's signal — this is the frozen `units` input
      // contract (api/openapi.js IscUnit.tetherAnchor), so it stays exactly
      // as external TCS-supplied units already expect it.
      matchedSignals: signals.primary ? [signals.primary] : [],
      // New, additive field — one entry per detected relative clause with its
      // own modal word. Not read anywhere yet; captured so a future version
      // can render or trace these separately. Absent entirely on units
      // supplied via the API's `units` input path, which is fine — every
      // reader of subordinateClauseSignals must treat a missing field the
      // same as an empty array.
      subordinateClauseSignals: signals.additional,
      traceReason,
    },
    parse: wih,
    risk: rds,
    missingSignals,
    controlFlags: [],
    driftDetected: false,
    status: missingSignals.length > 0 ? "incomplete" : "ok",
    lineage: { section: chain ? { records: chain.records } : null, sentence: lineage },
  };
}

// ─── Pre-pipeline text normalization regexes ─────────────────────────────────
// Hoisted so the lineage chain below can both run them and label the record
// they produce with a stable rule name.

const STRIKEOUT_RE = /\(\([\s\S]*?\)\)/g;

// The RCW/session-law citation + verb phrase that opens every amendment
// section. Matches both singular and "are each" forms:
//   "RCW 43.06.220 is amended to read as follows:"
//   "RCW 43.06.220 and section 5, chapter 20, Laws of 2023 are each amended
//    to read as follows:"
const AMENDMENT_HEADER_RE = /^.*?\b(?:is|are\s+each)\s+amended\s+to\s+read\s+as\s+follows\s*:\s*/i;

// The boilerplate that opens every addition section, e.g. "A new section is
// added to chapter 84.69 RCW to read as follows:". Without this strip the
// header has no period before it, so it stays glued to the first sentence;
// the subsection-marker strip below would then remove a "(1)" from the
// *middle* of that sentence instead of its start, breaking anchorText's
// substring match against the raw text.
const NEW_SECTION_HEADER_RE = /^.*?\b(?:is|are\s+each)\s+added\s+to\s+(?:chapter|the\s+chapter|title)\b.*?\bto\s+read\s+as\s+follows\s*:\s*/i;

// Subsection navigation markers — (1), (2)(a), (b)(i), etc. Only stripped
// when preceded by a sentence boundary (start of text, or a period).
// splitSentences only ever breaks on ".!?", so a marker after a semicolon
// or colon is not actually at a sentence's edge — it sits mid-sentence
// inside a colon/semicolon-joined list, and stripping it from there breaks
// anchorText's substring match against raw text. Inline cross-references
// like "subject to (2) of this subsection" follow prepositions and must be
// preserved — SKIPPED_SUBSECTION_RE below exists only to record that those
// were checked and deliberately left alone.
//
// A marker stripped right after a period leaves SUBSECTION_BREAK behind —
// that spot is a real sentence boundary even when the next word starts with
// a digit, $, or lowercase letter (e.g. "(1) 50 percent...", "(2) $500
// must..."), which splitSentences would otherwise miss. No marker precedes
// the start-of-text case, so nothing to mark there.
const MID_SUBSECTION_RE = /(\.\s+)(?:\(\d{1,2}\)|\([a-z]\))+\s*/g;
const LEADING_SUBSECTION_RE = /^(?:\(\d{1,2}\)|\([a-z]\))+\s*/;
const SKIPPED_SUBSECTION_RE = /[;:]\s+(?:\(\d{1,2}\)|\([a-z]\))+/;

// ─── Public entry point ───────────────────────────────────────────────────────

export function runPipeline(rawText, context = {}) {
  const secText = String(rawText || "");
  const chain = { records: [], nextNodeId: 0 };
  let tracked = trackedFromText(secText);
  let record = makeRecord(chain, {
    parentNodeId: null,
    text: tracked.text,
    producedBy: "section_split",
    ...trackedSpan(tracked, secText),
    rule: null,
    matched: null,
  });

  // Strip (( ... )) WA legislative markup (struck/substituted text)
  {
    const { tracked: next, matched } = stripGlobal(tracked, STRIKEOUT_RE);
    tracked = next;
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "strikeout_strip",
      ...trackedSpan(tracked, secText),
      rule: "(( )) markup",
      matched,
    });
  }

  // Whitespace collapse + trim
  {
    const { tracked: next, matched } = collapseRunsAndTrim(tracked, 1);
    tracked = next;
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "whitespace_normalize",
      ...trackedSpan(tracked, secText),
      rule: "collapse + trim",
      matched,
    });
  }

  // Detect section type before stripping the amendment header so the
  // "is amended to read as follows" phrase is still present for detection
  const sectionType = detectSectionType(tracked.text);

  // Strip amendment header
  {
    const { tracked: next, matched } = stripPrefix(tracked, AMENDMENT_HEADER_RE);
    tracked = next;
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "amendment_header_strip",
      ...trackedSpan(tracked, secText),
      rule: "is/are each amended to read as follows",
      matched,
    });
  }

  // Strip "new section added" header
  {
    const { tracked: next, matched } = stripPrefix(tracked, NEW_SECTION_HEADER_RE);
    tracked = next;
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "new_section_header_strip",
      ...trackedSpan(tracked, secText),
      rule: "is/are each added to ... read as follows",
      matched,
    });
  }

  // Strip subsection navigation markers — records both outcomes: markers
  // actually stripped, and markers deliberately left alone next to a
  // semicolon/colon because they aren't a real sentence boundary. Each
  // sub-step gets its own record, chained by parentNodeId, instead of
  // batching four outcomes onto a single trailing record.
  {
    const skipped = SKIPPED_SUBSECTION_RE.test(tracked.text);
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "subsection_marker_strip",
      ...trackedSpan(tracked, secText),
      rule: "marker after semicolon/colon — not a sentence boundary",
      matched: skipped,
    });

    const mid = stripMidSubsectionMarkers(tracked, MID_SUBSECTION_RE);
    tracked = mid.tracked;
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "subsection_marker_strip",
      ...trackedSpan(tracked, secText),
      rule: "marker after sentence boundary (period)",
      matched: mid.matched,
    });

    const lead = stripPrefix(tracked, LEADING_SUBSECTION_RE);
    tracked = lead.tracked;
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "subsection_marker_strip",
      ...trackedSpan(tracked, secText),
      rule: "marker at start of text",
      matched: lead.matched,
    });

    const cleaned = collapseRunsAndTrim(tracked, 2);
    tracked = cleaned.tracked;
    record = makeRecord(chain, {
      parentNodeId: record.id,
      text: tracked.text,
      producedBy: "whitespace_normalize",
      ...trackedSpan(tracked, secText),
      rule: "collapse runs of 2+ / trim",
      matched: cleaned.matched,
    });
  }

  const sentenceLineage = [];
  const signalSentences = extractSignalSentences(tracked, sentenceLineage, chain, record.id, secText); // L2 SSE
  // chain is passed (not a stripped copy) so L3 CFS records minted inside
  // buildUnit get sequential ids from the same per-section counter. The
  // internal nextNodeId counter itself never leaves this function — only
  // chain.records, the public record list, is exposed below.
  const units = signalSentences
    .map((s, i) => buildUnit(s, i, sectionType, context.billId || null, chain))
    .filter(Boolean);

  return {
    inputLength: tracked.text.length,
    sentenceCount: signalSentences.length,
    unitCount: units.length,
    units,
    lineage: {
      section: { records: chain.records },
      sentences: sentenceLineage,
    },
  };
}
