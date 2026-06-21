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

function trackedSpan(tracked) {
  if (tracked.text.length === 0) return [0, 0];
  return [tracked.offsets[0], tracked.offsets[tracked.offsets.length - 1] + 1];
}

// Node ids are sequential and unique within a chain — one chain per
// section, shared by the preamble nodes in chain.nodes and the
// sentence-split nodes in sentenceLineage (see runPipeline) — so a
// parentNodeId always resolves to a real node regardless of which list
// it lives in.
function nextNodeId(chain) {
  return chain.nextNodeId++;
}

function makeNode(chain, text, producedBy, position, parentNodeId = null) {
  const node = { nodeId: nextNodeId(chain), parentNodeId, text, producedBy, position };
  chain.nodes.push(node);
  return node;
}

function makeEdge(chain, step, rule, matched, fromNodeId, toNodeId) {
  const edge = { fromNodeId, toNodeId, step, rule, matched };
  chain.edges.push(edge);
  return edge;
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

function absolutePosition(tracked, start, end) {
  if (end <= start) return [tracked.offsets[start] ?? 0, tracked.offsets[start] ?? 0];
  return [tracked.offsets[start], tracked.offsets[end - 1] + 1];
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

// Splits via the unmodified splitSentences, then for each candidate sentence
// records a signal-detection lineage record — including ones with no signal,
// which are dropped here and never reach buildUnit. sentenceLineage collects
// every candidate regardless of outcome (see DESIGN.md "The Meaning Lineage
// Schema" — Edge — "checked, did not apply" must be recorded explicitly).
// Each sentence node's parentNodeId is set to parentNodeId — the final
// preamble-chain node it branched from — instead of leaving that
// relationship to be inferred from the order runPipeline called things in.
function extractSignalSentences(tracked, sentenceLineage, chain, parentNodeId) {
  const pieces = splitSentences(tracked.text);
  const out = [];
  let cursor = 0;
  for (const s of pieces) {
    const loc = locateSentence(tracked, s, cursor);
    const position = loc ? absolutePosition(tracked, loc.start, loc.end) : [0, 0];
    if (loc) cursor = loc.end;

    const signal = detectSignal(s);
    const sentenceNodeId = nextNodeId(chain);
    const record = {
      node: { nodeId: sentenceNodeId, parentNodeId, text: s, producedBy: "sentence_split", position },
      signalEdge: {
        fromNodeId: parentNodeId,
        toNodeId: sentenceNodeId,
        step: "L2 SSE",
        rule: signal ? SIGNAL_RULE[signal] : "no_signal_matched",
        matched: signal !== null,
      },
    };
    sentenceLineage.push(record);

    if (signal !== null) out.push({ text: s, signal, lineage: record });
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

function buildUnit(sentenceObj, sourceIndex, sectionType = { type: "standard" }, billId = null, sectionChain = null) {
  const { text, signal, lineage } = sentenceObj;

  const cfs = checkConstraintFilter(text); // L3 CFS
  if (lineage) {
    // No node follows L3 CFS — it filters text, it doesn't transform it —
    // so there's nothing for toNodeId to point at, matched or not.
    lineage.constraintFilterEdge = {
      fromNodeId: lineage.node.nodeId,
      toNodeId: null,
      step: "L3 CFS",
      rule: cfs.rule,
      matched: !cfs.passed,
      dropped: !cfs.passed,
    };
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
  if (signal === "obligation" && !wih.how.enforcement) {
    missingSignals.push("missing_enforcement");
  }

  // L10 ISC
  return {
    sectionType,
    tetherAnchor: {
      type: "text_span",
      sourceSystem: "plain_meaning_pipeline",
      sourceLocation: `sentence_${sourceIndex + 1}`,
      anchorText: text,
      sourceDerivedText: norm,
      matchedSignals: [signal],
      traceReason: `Matched ${signal} signal language in source text`,
    },
    parse: wih,
    risk: rds,
    missingSignals,
    controlFlags: [],
    driftDetected: false,
    status: missingSignals.length > 0 ? "incomplete" : "ok",
    lineage: { section: sectionChain, sentence: lineage },
  };
}

// ─── Pre-pipeline text normalization regexes ─────────────────────────────────
// Hoisted so the lineage chain below can both run them and label the edge
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
  const chain = { nodes: [], edges: [], nextNodeId: 0 };
  let tracked = trackedFromText(secText);
  let node = makeNode(chain, tracked.text, "section_split", trackedSpan(tracked));

  // Strip (( ... )) WA legislative markup (struck/substituted text)
  {
    const { tracked: next, matched } = stripGlobal(tracked, STRIKEOUT_RE);
    tracked = next;
    const nextNode = makeNode(chain, tracked.text, "strikeout_strip", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "strikeout_strip", "(( )) markup", matched, node.nodeId, nextNode.nodeId);
    node = nextNode;
  }

  // Whitespace collapse + trim
  {
    const { tracked: next, matched } = collapseRunsAndTrim(tracked, 1);
    tracked = next;
    const nextNode = makeNode(chain, tracked.text, "whitespace_normalize", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "whitespace_normalize", "collapse + trim", matched, node.nodeId, nextNode.nodeId);
    node = nextNode;
  }

  // Detect section type before stripping the amendment header so the
  // "is amended to read as follows" phrase is still present for detection
  const sectionType = detectSectionType(tracked.text);

  // Strip amendment header
  {
    const { tracked: next, matched } = stripPrefix(tracked, AMENDMENT_HEADER_RE);
    tracked = next;
    const nextNode = makeNode(chain, tracked.text, "amendment_header_strip", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "amendment_header_strip", "is/are each amended to read as follows", matched, node.nodeId, nextNode.nodeId);
    node = nextNode;
  }

  // Strip "new section added" header
  {
    const { tracked: next, matched } = stripPrefix(tracked, NEW_SECTION_HEADER_RE);
    tracked = next;
    const nextNode = makeNode(chain, tracked.text, "new_section_header_strip", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "new_section_header_strip", "is/are each added to ... read as follows", matched, node.nodeId, nextNode.nodeId);
    node = nextNode;
  }

  // Strip subsection navigation markers — records both outcomes: markers
  // actually stripped, and markers deliberately left alone next to a
  // semicolon/colon because they aren't a real sentence boundary. Each
  // sub-step gets its own node so every edge connects two real nodes, per
  // DESIGN.md, instead of batching four edges onto a single trailing node.
  {
    const skipped = SKIPPED_SUBSECTION_RE.test(tracked.text);
    let nextNode = makeNode(chain, tracked.text, "subsection_marker_strip", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "subsection_marker_strip", "marker after semicolon/colon — not a sentence boundary", skipped, node.nodeId, nextNode.nodeId);
    node = nextNode;

    const mid = stripMidSubsectionMarkers(tracked, MID_SUBSECTION_RE);
    tracked = mid.tracked;
    nextNode = makeNode(chain, tracked.text, "subsection_marker_strip", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "subsection_marker_strip", "marker after sentence boundary (period)", mid.matched, node.nodeId, nextNode.nodeId);
    node = nextNode;

    const lead = stripPrefix(tracked, LEADING_SUBSECTION_RE);
    tracked = lead.tracked;
    nextNode = makeNode(chain, tracked.text, "subsection_marker_strip", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "subsection_marker_strip", "marker at start of text", lead.matched, node.nodeId, nextNode.nodeId);
    node = nextNode;

    const cleaned = collapseRunsAndTrim(tracked, 2);
    tracked = cleaned.tracked;
    nextNode = makeNode(chain, tracked.text, "whitespace_normalize", trackedSpan(tracked), node.nodeId);
    makeEdge(chain, "whitespace_normalize", "collapse runs of 2+ / trim", cleaned.matched, node.nodeId, nextNode.nodeId);
    node = nextNode;
  }

  const sentenceLineage = [];
  const signalSentences = extractSignalSentences(tracked, sentenceLineage, chain, node.nodeId); // L2 SSE
  // Strip the internal nextNodeId counter before this is handed out —
  // it's bookkeeping for id assignment, not part of the public lineage shape.
  const publicChain = { nodes: chain.nodes, edges: chain.edges };
  const units = signalSentences
    .map((s, i) => buildUnit(s, i, sectionType, context.billId || null, publicChain))
    .filter(Boolean);

  return {
    inputLength: tracked.text.length,
    sentenceCount: signalSentences.length,
    unitCount: units.length,
    units,
    lineage: {
      section: publicChain,
      sentences: sentenceLineage,
    },
  };
}
