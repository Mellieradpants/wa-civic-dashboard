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
const NEXT_MARKER_RE = /\b(which|that|who)\b/i;
const CLAUSE_MODAL_RE = /\b(may|shall|must)\b/i;

// ─── isVerbLike: pure word classifier ────────────────────────────────────────
// Knows nothing about clauses, markers, or demonstratives — only whether a
// single word is a modal or a verb. english-verbs.json only lists base forms,
// so common inflections are checked as candidate stems rather than trusting
// exact string membership, plus a small fixed map for irregular
// copula/auxiliary forms no suffix rule can derive ("is", "are", "has"...).
const IRREGULAR_VERB_FORMS = new Map([
  ["is", "be"], ["are", "be"], ["was", "be"], ["were", "be"], ["been", "be"], ["being", "be"], ["am", "be"],
  ["has", "have"], ["have", "have"], ["had", "have"],
  ["does", "do"], ["did", "do"], ["done", "do"],
]);

function inflectionCandidates(word) {
  const candidates = [word];
  if (word.endsWith("ies") && word.length > 4) candidates.push(word.slice(0, -3) + "y");
  if (word.endsWith("es") && word.length > 3) candidates.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 2) candidates.push(word.slice(0, -1));
  if (word.endsWith("ing") && word.length > 4) {
    const stem = word.slice(0, -3);
    candidates.push(stem, stem + "e");
    if (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2]) candidates.push(stem.slice(0, -1));
  }
  if (word.endsWith("ed") && word.length > 3) {
    const stem = word.slice(0, -2);
    candidates.push(stem, stem + "e");
    if (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2]) candidates.push(stem.slice(0, -1));
  }
  return candidates;
}

function isVerbLike(rawWord) {
  const w = rawWord.toLowerCase();
  if (!w) return false;
  if (CLAUSE_MODAL_RE.test(w)) return true;
  if (IRREGULAR_VERB_FORMS.has(w)) return true;
  return inflectionCandidates(w).some((candidate) => ENGLISH_VERBS.has(candidate));
}

// ─── isDemonstrativeThat: pure gate ──────────────────────────────────────────
// A demonstrative "that" ("at that hearing", "under that chapter") is a bare
// noun phrase — it never has a verb of its own before the phrase genuinely
// ends. Computes its own boundary from the raw text after the marker only;
// shares no state with findClauseSpan below, which has no idea this gate
// exists upstream of it.
//
// A determiner-like word directly after "that" ("any", "the", "such"...)
// blocks the demonstrative call outright, even with no verb found — a
// determiner never continues a genuine demonstrative ("that a hearing" isn't
// English), so this is a safe, narrow signal on its own.
//
// The boundary is a real clause-ending punctuation mark: a colon or
// semicolon always ends it; a period only ends it if it isn't immediately
// followed by another character (excludes RCW-citation-style periods, as in
// "36.70A.040") and the token right before it isn't a known abbreviation
// (excludes "Federalist No. 40") — two separate checks for two separate
// problems, not one combined regex.
const DETERMINER_RE = /^(a|an|the|any|such|no|each|every|all|some)$/i;
const ABBREVIATION_BEFORE_PERIOD_RE =
  /\b(no|nos|sec|secs|ch|chs|vs|etc|e\.g|i\.e|mr|mrs|dr|jr|sr|st|c|ss|sp\.s|u\.s\.c|p\.l|r\.c\.w|cf|vol|para|art|cl|tit|subd|sess)$/i;

function findClauseEndBoundary(text) {
  const punctRe = /[:;.]/g;
  let m;
  while ((m = punctRe.exec(text)) !== null) {
    const ch = m[0];
    if (ch === ":" || ch === ";") return m.index;
    const nextChar = text[m.index + 1];
    if (nextChar && !/\s/.test(nextChar)) continue; // RCW-citation-style period ("36.70A.040") — not a boundary
    const before = text.slice(0, m.index);
    const tokenMatch = before.match(/([A-Za-z.]+)$/);
    if (tokenMatch && ABBREVIATION_BEFORE_PERIOD_RE.test(tokenMatch[1])) continue; // known abbreviation ("No.") — not a boundary
    return m.index;
  }
  return -1;
}

function firstWordAfter(afterMarker) {
  const m = /^\s*([A-Za-z']+)/.exec(afterMarker);
  return m ? m[1].toLowerCase() : null;
}

function isDemonstrativeThat(afterMarker) {
  const firstWord = firstWordAfter(afterMarker);
  if (firstWord && DETERMINER_RE.test(firstWord)) return false;

  const boundary = findClauseEndBoundary(afterMarker);
  const scanRegion = boundary === -1 ? afterMarker : afterMarker.slice(0, boundary);
  const words = scanRegion.split(/\s+/).map((w) => w.replace(/[^a-zA-Z']/g, "")).filter(Boolean);
  if (words.length === 0) return false; // empty gap — not enough evidence to call it demonstrative
  return !words.some(isVerbLike);
}

// ─── findClauseSpan: the shared span-finder ──────────────────────────────────
// Unaware that isDemonstrativeThat exists — used identically for which/who
// and for any "that" that passes the gate above.
//
// A clause's span runs from its marker through its own first modal word and
// whatever follows it, stopping at the next modal word after that (where the
// main clause's own instruction resumes) or at the end of the text if there
// isn't one. This boundary rule — not punctuation — is what keeps a genuine
// main-clause obligation ("who may be aggrieved shall file...") from getting
// swallowed into the relative clause: "shall" there is a second, later modal,
// so the clause span stops right before it.
//
// Both searches (this clause's own modal, and the next modal marking where it
// ends) are bounded by the next relative-clause marker, if any comes first.
// Without that bound, a clause with no modal of its own (e.g. "which is
// scorable under subsection (1)(b)...") would keep scanning forward past a
// second, unrelated "which" clause and steal that later clause's modal for
// itself — swallowing a real, separate clause into its own span instead of
// correctly finding no modal and being skipped.
function findClauseSpan(text, markerIndex, markerLength, afterMarker) {
  const nextMarkerMatch = NEXT_MARKER_RE.exec(afterMarker);
  const searchWindow = nextMarkerMatch ? afterMarker.slice(0, nextMarkerMatch.index) : afterMarker;

  const ownModalMatch = CLAUSE_MODAL_RE.exec(searchWindow);
  if (!ownModalMatch) return null; // no modal before the next clause (or the end) — not a candidate

  const afterOwnModal = searchWindow.slice(ownModalMatch.index + ownModalMatch[0].length);
  const nextModalMatch = CLAUSE_MODAL_RE.exec(afterOwnModal);
  const clauseEndOffset = nextModalMatch
    ? ownModalMatch.index + ownModalMatch[0].length + nextModalMatch.index
    : searchWindow.length;

  const span = [markerIndex, markerIndex + markerLength + clauseEndOffset];
  const clauseText = text.slice(span[0], span[1]).trim();
  return { clauseText, span, signal: detectSignal(clauseText) };
}

// ─── detectRelativeClauses: orchestrator ─────────────────────────────────────
// Wires the three pieces together and decides nothing itself: gates "that"
// through isDemonstrativeThat, then hands every candidate marker to the same
// findClauseSpan which/who always used.
function detectRelativeClauses(text) {
  const clauses = [];
  RELATIVE_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = RELATIVE_MARKER_RE.exec(text)) !== null) {
    const marker = m[0].toLowerCase();
    const afterMarker = text.slice(m.index + m[0].length);

    if (marker === "that" && isDemonstrativeThat(afterMarker)) {
      RELATIVE_MARKER_RE.lastIndex = m.index + m[0].length;
      continue;
    }

    const found = findClauseSpan(text, m.index, m[0].length, afterMarker);
    if (!found) {
      RELATIVE_MARKER_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    clauses.push({ marker, clauseText: found.clauseText, span: found.span, signal: found.signal });
    RELATIVE_MARKER_RE.lastIndex = found.span[1];
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

// Second-instruction scan reuses MODAL_RE's own word list, with one
// difference: a bare "may" doesn't count when it's immediately followed by a
// day-number ("May 1", "May 12") — the same "May [date]" collision documented
// as a known pipeline limitation elsewhere. Without this guard, a date would
// get miscounted as a second modal and produce a fake second instruction.
const SECOND_MODAL_RE =
  /\b(is no longer required to|are no longer required to|is responsible for|are responsible for|are each repealed|is repealed|is(?:\s+hereby)?\s+appropriated|shall not|must not|may not|(?:is|are)\s+(?:\w+\s+)?obligated to|obligated to|shall|must|cannot|is required to|are required to|may(?!\s*\d))\b/i;

// A sentence with two independent, equally-weighted instructions joined by
// "and" — different actor, different requirement each — has its own modal
// word for the second instruction, separate from the first. Only fires when
// there's real text between "and" and that second modal (a genuinely
// distinct actor candidate); a modal sitting immediately after "and" with
// nothing between is the same-actor case already handled by
// renderer.js's splitCompoundAction and is deliberately left alone here.
const CONDITION_LEAD_RE = /^(?:if|when|unless|until|except|provided\s+that|in\s+the\s+event)\b/i;
const BACK_REFERENCE_PRONOUNS = new Set(["it", "they", "he", "she", "this", "these"]);
const MAX_SECOND_ACTOR_WORDS = 12;

// A candidate actor is judged on what it grammatically IS, not on whether its
// wording happens to match the first actor. "One of the teams" appearing
// twice, referring to two different teams, is a real second instruction —
// identical wording is never on its own a reason to reject. Only a
// back-reference (the span's own last word is a bare pronoun) means "this is
// still the first actor speaking again," e.g. "...and, therefore, it must be
// flexible" — "it" refers back to the first actor, not a new one.
function detectSecondInstruction(actionText) {
  if (!actionText) return null;

  const modalMatch = SECOND_MODAL_RE.exec(actionText);
  if (!modalMatch) return null; // no second modal at all — never a candidate

  const beforeModal = actionText.slice(0, modalMatch.index);
  const andMatches = [...beforeModal.matchAll(/\band\b/gi)];
  if (!andMatches.length) return null; // second modal exists but isn't "and"-joined — out of scope
  const lastAnd = andMatches[andMatches.length - 1];

  const actor2 = beforeModal
    .slice(lastAnd.index + lastAnd[0].length)
    .replace(/^[,\s]+/, "")
    .replace(/[,\s]+$/, "");
  if (!actor2) return null; // zero-width gap — same-actor case, already handled elsewhere

  if (CONDITION_LEAD_RE.test(actor2)) return null; // a condition clause, not a second actor
  const words = actor2.split(/\s+/);
  if (words.length > MAX_SECOND_ACTOR_WORDS) return null;
  const lastWord = words[words.length - 1].replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (BACK_REFERENCE_PRONOUNS.has(lastWord)) return null; // back-reference to the first actor

  const action2 = actionText
    .slice(modalMatch.index + modalMatch[0].length)
    .replace(/^[,\s]+/, "")
    .trim() || null;
  if (!action2) return null;

  const action1 = actionText.slice(0, lastAnd.index).trim();
  if (!action1) return null;

  return { action1, actor2, modal2: modalMatch[0].trim().toLowerCase(), action2 };
}

// Returns an array of one or more {actor, modal, action, conditions} groups
// — normally just one, or two when detectSecondInstruction finds a genuine
// second actor with its own requirement. Every group keeps the same shape a
// single result always had, so per-unit output (and the frozen `units` API
// contract) is unchanged; only how many units one sentence can produce
// changes. The second group's conditions are left empty rather than
// duplicating the first group's — conditions extracted from the whole
// sentence can't be reliably attributed to one clause or the other, and a
// wrong attribution is worse than none (same choice already made for the
// same-actor compound-split case in renderer.js's clause2Fields).
function parseActorActionCondition(text) {
  const norm = normalize(text);
  const modalMatch = norm.match(MODAL_RE);

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

  if (!modalMatch) {
    return [{ actor: null, modal: null, action: null, conditions }];
  }

  const idx = modalMatch.index;
  let rawActor = norm.slice(0, idx).replace(/,\s*$/, "").trim() || null;
  // Strip leading condition clause so "If X, the department" → "the department".
  // If the clause has no comma-separated tail, or the tail is a prepositional
  // fragment, return null rather than passing contaminated text as the actor.
  if (rawActor && CONDITION_LEAD_RE.test(rawActor)) {
    const lastCommaIdx = rawActor.lastIndexOf(",");
    const tail = lastCommaIdx >= 0 ? rawActor.slice(lastCommaIdx + 1).trim() : "";
    rawActor = (tail.length > 2 && !/^(?:in|on|at|by|for|with|through|via|pursuant|notwithstanding)\b/i.test(tail))
      ? tail : null;
  }
  const actor = rawActor;
  let modal = modalMatch[0].trim().toLowerCase();
  let action = norm
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

  const second = detectSecondInstruction(action);
  if (!second) {
    return [{ actor, modal, action, conditions }];
  }

  return [
    { actor, modal, action: second.action1, conditions },
    { actor: second.actor2, modal: second.modal2, action: second.action2, conditions: [] },
  ];
}

// A split instruction's signal is derived from its own modal word rather
// than reusing the whole sentence's signals.primary — a sentence with an
// obligation clause and a prohibition clause would otherwise mislabel
// whichever clause doesn't match the sentence-wide first-match-wins signal
// (see detectSignal). Only used for the second instruction of a split; the
// first keeps using signals.primary exactly as a single-instruction sentence
// always has, so single-instruction behavior is completely unchanged.
function signalForModal(modal) {
  if (!modal) return null;
  const m = modal.toLowerCase();
  if (m === "cannot" || /\bnot\b/.test(m)) return "prohibition";
  if (m === "may") return "permission";
  return "obligation";
}

// ─── Inclusion/exclusion list detection (applicability modifiers) ──────────
// Detects "including"/"excluding" lists inside a sentence and records where
// each one starts and ends, so L5 AAC's actor/action/modal parsing can treat
// the detected span as absent — a list is never part of the derived action
// string. Detection only: this never restructures the sentence or forces any
// hierarchy on what it finds; a sentence can contain more than one marker.
// The gates/shapes below are unchanged from a rule validated over five
// rounds against 615 real bill sentences — generalized only to scan every
// marker in a sentence instead of stopping at the first.

const INCLUSION_MARKER_SCAN_RE = /\b(including|excluding)\b/gi;

const INCLUSION_FILLER_PHRASES = [
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
const INCLUSION_FILLER_RE = new RegExp(
  `^\\s*,?\\s*(${INCLUSION_FILLER_PHRASES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")})\\s*,?\\s*`,
  "i"
);

const INCLUSION_GATE2_PRECEDING_WORDS = new Set(["of", "by", "from", "for", "requires", "require", "is", "are"]);

const INCLUSION_STOP2_PHRASES = [
  "shall not", "does not", "do not",
  "shall", "must", "may not", "may", "will",
  "is", "are", "was", "were", "be", "been",
  "requires", "constitutes", "files",
  "multiplied", "divided",
];
const INCLUSION_STOP2_RE = new RegExp(
  `\\b(${INCLUSION_STOP2_PHRASES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i"
);

const INCLUSION_STOP3_CONNECTORS = [
  "so long as", "if", "unless", "except", "provided", "whether",
  "on", "to", "in", "for", "of", "upon", "regardless",
];

const INCLUSION_REFERENCE_TAG_RE =
  /^\s*as\s+(defined|described|provided|authorized|required|identified|specified|set forth)\s+in\b/i;
const INCLUSION_BUT_CONTINUE_RE = /^\s*but\s+(that|who|which)\b/i;
const INCLUSION_BUT_ANY_RE = /^\s*but\b/i;

const INCLUSION_BARE_WORD_RE = new RegExp(
  `\\b(${INCLUSION_STOP2_PHRASES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")}|if|unless|also\\s+[a-z]+)\\b`,
  "gi"
);

// A relative/interrogative pronoun between the most recent comma (or list
// start) and a bare STOP-4 word means the verb describes the current list
// item, not a fresh instruction — e.g. "...any hospital that comes within...
// if the hospital is also licensed..." never resumes on "is"/"also licensed".
const INCLUSION_RELATIVE_PRONOUN_RE = /\b(who|whom|whose|that|which|whether)\b/i;

function inclusionLastWord(s) {
  const m = s.trim().match(/([A-Za-z']+)$/);
  return m ? m[1].toLowerCase() : null;
}

// A line ending in normal sentence structure (colon, semicolon, "; and",
// "; or", ", and", ", or") is never a table label line; the table gate only
// fires on 3+ consecutive label-like lines at/adjacent to the marker's line,
// so an ordinary lettered list is never mistaken for a table.
function inclusionIsShortLabelLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length >= 60) return false;
  if (/^\(?[a-zA-Z0-9]{1,3}\)/.test(trimmed)) return false;
  if (/[.!?]/.test(trimmed)) return false;
  if (/[:;]\s*$/.test(trimmed)) return false;
  if (/[,;]\s*(and|or)\s*$/i.test(trimmed)) return false;
  return true;
}

function inclusionLooksLikeTableBlock(sentence, markerIndex) {
  const lines = sentence.split("\n");
  let charCount = 0;
  let markerLineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= markerIndex) { markerLineIdx = i; break; }
    charCount += lines[i].length + 1;
  }
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i <= lines.length; i++) {
    const isLabel = i < lines.length && inclusionIsShortLabelLine(lines[i]);
    if (isLabel) {
      if (runLen === 0) runStart = i;
      runLen++;
    } else {
      if (runLen >= 3) {
        const runEnd = i - 1;
        if (runEnd >= markerLineIdx - 1 && runStart <= markerLineIdx + 1) return true;
      }
      runLen = 0;
    }
  }
  return false;
}

function inclusionAbsorbFillers(sentence, startPos) {
  let pos = startPos;
  while (true) {
    const m = INCLUSION_FILLER_RE.exec(sentence.slice(pos));
    if (!m) break;
    pos += m[0].length;
  }
  return pos;
}

function inclusionFindEnclosingParen(sentence, markerStart) {
  const stack = [];
  for (let i = 0; i < markerStart; i++) {
    if (sentence[i] === "(") stack.push(i);
    else if (sentence[i] === ")") stack.pop();
  }
  return stack.length > 0 ? stack[stack.length - 1] : -1;
}

// "May" the month (e.g. "May 1, 2026") must not be treated as the modal
// "may" in STOP-2/STOP-4 — only a bare "may" (not "may not") immediately
// followed by a day-number is the date case.
function inclusionIsMayDateMatch(text, matchIndex, matchText) {
  if (matchText.toLowerCase() !== "may") return false;
  const after = text.slice(matchIndex + matchText.length);
  return /^\s+\d{1,2}(st|nd|rd|th)?\b/i.test(after);
}

function inclusionStop2SegmentFires(segment) {
  const re = new RegExp(INCLUSION_STOP2_RE.source, "gi");
  let mm;
  while ((mm = re.exec(segment))) {
    if (inclusionIsMayDateMatch(segment, mm.index, mm[0])) continue;
    // The comma-side infinitive guard applies only to a final coordinated
    // item (segment starting with "and"/"or") — e.g. ", and power to be
    // used". Elsewhere, ", ... to be ..." is a trailing modifier and ends
    // the list.
    if (
      /^(be|been)$/i.test(mm[0]) &&
      /\bto\s*$/i.test(segment.slice(0, mm.index)) &&
      /^\s*(and|or)\b/i.test(segment)
    ) continue;
    return true;
  }
  return false;
}

// The colon-sublist shape triggers on a colon within the first N words after
// the marker (after filler), not only immediately after — e.g. "including
// the following:".
function inclusionFindLookaheadColon(sentence, scanPos, maxWords) {
  const text = sentence.slice(scanPos);
  const re = /\S+/g;
  let m;
  let wordsSeen = 0;
  while ((m = re.exec(text)) && wordsSeen < maxWords) {
    const token = m[0];
    const colonIdxInToken = token.indexOf(":");
    if (colonIdxInToken !== -1) return scanPos + m.index + colonIdxInToken;
    if (/[.;]/.test(token)) return -1;
    wordsSeen++;
  }
  return -1;
}

function inclusionFindCommaBoundedStop(sentence, scanPos) {
  const candidates = [];

  // STOP-1: every semicolon is a hard-stop candidate.
  for (let idx = sentence.indexOf(";", scanPos); idx !== -1; idx = sentence.indexOf(";", idx + 1)) {
    candidates.push(idx);
  }

  // STOP-4: bare instruction/if/unless/"also X" word with no comma directly
  // before it, and not describing the current item via a relative/
  // interrogative pronoun since the most recent comma. The infinitive guard
  // ("to be"/"to been") applies unconditionally here — no and/or requirement.
  INCLUSION_BARE_WORD_RE.lastIndex = 0;
  let bm;
  while ((bm = INCLUSION_BARE_WORD_RE.exec(sentence))) {
    if (bm.index < scanPos) continue;
    if (inclusionIsMayDateMatch(sentence, bm.index, bm[0])) continue;
    const before = sentence.slice(0, bm.index).replace(/\s+$/, "");
    if (before.endsWith(",")) continue;
    if (/^(be|been)$/i.test(bm[0]) && /\bto$/i.test(before)) continue;
    const lastCommaBefore = sentence.lastIndexOf(",", bm.index);
    const spanStart = lastCommaBefore >= scanPos ? lastCommaBefore + 1 : scanPos;
    const backSpan = sentence.slice(spanStart, bm.index);
    if (INCLUSION_RELATIVE_PRONOUN_RE.test(backSpan)) continue;
    candidates.push(bm.index);
  }

  // STOP-2 / STOP-3: comma-triggered, with "but"/reference-tag exceptions.
  for (let idx = sentence.indexOf(",", scanPos); idx !== -1; idx = sentence.indexOf(",", idx + 1)) {
    const rest = sentence.slice(idx + 1);

    if (INCLUSION_BUT_CONTINUE_RE.test(rest)) continue;
    if (INCLUSION_REFERENCE_TAG_RE.test(rest)) continue;

    if (INCLUSION_BUT_ANY_RE.test(rest)) {
      candidates.push(idx);
      continue;
    }

    const nextCommaIdx = sentence.indexOf(",", idx + 1);
    const nextSemiIdx = sentence.indexOf(";", idx + 1);
    let segmentEnd = sentence.length;
    if (nextCommaIdx !== -1) segmentEnd = Math.min(segmentEnd, nextCommaIdx);
    if (nextSemiIdx !== -1) segmentEnd = Math.min(segmentEnd, nextSemiIdx);
    const segment = sentence.slice(idx + 1, segmentEnd);

    const stop3Fires = INCLUSION_STOP3_CONNECTORS.some((w) =>
      new RegExp(`^\\s*${w.replace(/\s+/g, "\\s+")}\\b`, "i").test(rest)
    );
    if (stop3Fires) {
      candidates.push(idx);
      continue;
    }

    if (inclusionStop2SegmentFires(segment)) {
      candidates.push(idx);
      continue;
    }
  }

  const inRange = candidates.filter((p) => p >= scanPos);
  if (inRange.length === 0) return null;
  return Math.min(...inRange);
}

// Real callers (api/plain-meaning.js) never supply a billId at all, so this
// only extracts a number when one happens to be present (as test/diagnostic
// harnesses do) — Gate 3(a)'s bill-number-range check is skipped, not
// falsely triggered, when no bill number is available.
function parseBillNumberFromId(billId) {
  if (!billId) return null;
  const m = String(billId).match(/\d+/);
  return m ? Number(m[0]) : null;
}

// Classifies and bounds ONE marker already found at markerStart/markerWord.
// detectInclusionLists (below) is what generalizes this to every marker in a
// sentence; the gates/shapes here are unchanged from the validated rule.
function classifyInclusionMarker(sentence, markerStart, markerWord, billNumber) {
  const markerEnd = markerStart + markerWord.length;
  const marker = markerWord.toLowerCase();

  // Gate 1 — reversal check
  const before = sentence.slice(0, markerStart).replace(/,\s*$/, "");
  if (inclusionLastWord(before) === "not") {
    return { marker, classification: "REVERSED", start: markerStart, end: markerEnd, listText: null };
  }

  // Gate 2 — verb-use check: skip only if NOT followed by a filler
  const precedingWord = inclusionLastWord(before);
  const followedByFiller = INCLUSION_FILLER_RE.test(sentence.slice(markerEnd));
  if (precedingWord && INCLUSION_GATE2_PRECEDING_WORDS.has(precedingWord) && !followedByFiller) {
    return { marker, classification: "NOT_A_LIST", start: markerStart, end: markerEnd, listText: null };
  }

  // Gate 3 — non-sentence check
  if (
    billNumber !== null &&
    ((billNumber >= 4000 && billNumber <= 4999) || (billNumber >= 8000 && billNumber <= 8999))
  ) {
    return { marker, classification: "NON_SENTENCE", start: markerStart, end: markerEnd, listText: null };
  }
  if (inclusionLooksLikeTableBlock(sentence, markerStart)) {
    return { marker, classification: "NON_SENTENCE", start: markerStart, end: markerEnd, listText: null };
  }

  const scanPos = inclusionAbsorbFillers(sentence, markerEnd);

  // Shape (a): PARENTHETICAL — the list is exactly the parenthetical content
  const openParenIdx = inclusionFindEnclosingParen(sentence, markerStart);
  if (openParenIdx !== -1) {
    const closeIdx = sentence.indexOf(")", scanPos);
    if (closeIdx !== -1) {
      return {
        marker,
        classification: "PARENTHETICAL",
        start: openParenIdx + 1,
        end: closeIdx,
        listText: sentence.slice(openParenIdx + 1, closeIdx),
        excisionSpan: [openParenIdx, closeIdx + 1],
      };
    }
  }

  // Shape (b): COLON_SUBLIST — colon within the first 6 words after the
  // marker/filler, not only immediately after
  const colonIdx = inclusionFindLookaheadColon(sentence, scanPos, 6);
  if (colonIdx !== -1) {
    const afterColon = sentence.slice(colonIdx + 1);
    const firstItemMatch = /^\s*\n?\s*\(?[a-zA-Z0-9]{1,3}\)/.exec(afterColon);
    if (firstItemMatch) {
      const linesAfterColon = afterColon.split("\n");
      let consumedLines = 0;
      for (const line of linesAfterColon) {
        if (/^\s*\(?[a-zA-Z0-9]{1,3}\)/.test(line) || line.trim() === "") {
          consumedLines++;
        } else {
          break;
        }
      }
      const consumedText = linesAfterColon.slice(0, consumedLines).join("\n");
      const endIdx = colonIdx + 1 + consumedText.length;
      return {
        marker,
        classification: "COLON_SUBLIST",
        start: markerStart,
        end: endIdx,
        listText: sentence.slice(markerStart, endIdx),
        excisionSpan: [markerStart, endIdx],
      };
    }
    const endIdx = sentence.replace(/[.;]+\s*$/, "").length;
    return {
      marker,
      classification: "COLON_SUBLIST",
      start: markerStart,
      end: endIdx,
      listText: sentence.slice(markerStart, endIdx),
      excisionSpan: [markerStart, endIdx],
    };
  }

  // Shape (c): COMMA_BOUNDED
  const stopPos = inclusionFindCommaBoundedStop(sentence, scanPos);
  if (stopPos !== null) {
    const endIdx = sentence.slice(0, stopPos).replace(/\s+$/, "").length;
    return {
      marker,
      classification: "COMMA_BOUNDED",
      start: markerStart,
      end: endIdx,
      listText: sentence.slice(markerStart, endIdx),
      excisionSpan: [markerStart, endIdx],
    };
  }

  // Shape (d): SENTENCE_END
  const endIdx = sentence.replace(/[.;]+\s*$/, "").length;
  return {
    marker,
    classification: "SENTENCE_END",
    start: markerStart,
    end: endIdx,
    listText: sentence.slice(markerStart, endIdx),
    excisionSpan: [markerStart, endIdx],
  };
}

// Scans every "including"/"excluding" marker in the sentence — not just the
// first — reusing classifyInclusionMarker's gates/shapes unchanged for each
// one. After a marker with a real detected span, the scan resumes past that
// span's end rather than immediately after the marker word, so a marker that
// happens to sit inside an already-detected list (nested markers) is folded
// into the outer list instead of being re-detected as its own — the
// accepted "one outer list, no inner list extracted" behavior.
function detectInclusionLists(sentence, billNumber) {
  const results = [];
  let searchFrom = 0;
  while (searchFrom <= sentence.length) {
    INCLUSION_MARKER_SCAN_RE.lastIndex = searchFrom;
    const m = INCLUSION_MARKER_SCAN_RE.exec(sentence);
    if (!m) break;
    const entry = classifyInclusionMarker(sentence, m.index, m[0], billNumber);
    results.push(entry);
    searchFrom = Math.max(entry.end, m.index + m[0].length);
  }
  return results;
}

// Removes only the classifications that carry real detected list text
// (PARENTHETICAL/COLON_SUBLIST/COMMA_BOUNDED/SENTENCE_END) from the copy of
// the text that feeds L5 AAC — REVERSED/NOT_A_LIST/NON_SENTENCE change
// nothing, consistent with them being recorded classifications only. Spans
// are removed back-to-front so earlier spans' offsets stay valid while later
// ones are excised.
function stripInclusionListSpans(text, inclusionLists) {
  const spans = inclusionLists
    .filter((l) => l.excisionSpan)
    .map((l) => l.excisionSpan)
    .sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [start, end] of spans) {
    const before = out.slice(0, start);
    const after = out.slice(end);
    const afterTrimmed = after.replace(/^\s+/, "");
    if (/,\s*$/.test(before) && afterTrimmed.startsWith(",")) {
      // Removing a mid-sentence span often leaves the comma before it
      // butted up against the comma after it — collapse to one.
      out = `${before.replace(/,\s*$/, ",")}${afterTrimmed.slice(1)}`;
    } else if (afterTrimmed.startsWith(",") || afterTrimmed.startsWith(";")) {
      // A lone leading comma/semicolon shouldn't pick up a space before it.
      out = `${before.replace(/\s+$/, "")}${afterTrimmed}`;
    } else {
      out = `${before} ${after}`;
    }
  }
  return out.replace(/\s+/g, " ").trim();
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

// Returns an array of zero or more ISC units — zero when L3 CFS blocks the
// sentence, one for the overwhelming majority of sentences, or two when L5
// AAC finds a genuine second independent instruction. sourceLocation isn't
// assigned here: it's a running count across every unit the whole section
// produces, not the sentence's own position, so runPipeline assigns it after
// flattening every sentence's units together.
function buildUnit(sentenceObj, sectionType = { type: "standard" }, billId = null, chain = null) {
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
  if (!cfs.passed) return [];

  const norm = normalize(text); // L4 LNS

  // Applicability-modifier detection (including/excluding lists) runs on the
  // same normalized text L5 AAC is about to consume, so recorded offsets
  // line up with sourceDerivedText below. Detection only — a separate, narrow
  // step (stripInclusionListSpans) removes just the classifications that
  // carry real list text from the COPY of the text handed to AAC, so the
  // list is never part of the derived action string; sourceDerivedText
  // itself stays the untouched L4 LNS output.
  const billNumber = parseBillNumberFromId(billId);
  const inclusionLists = detectInclusionLists(norm, billNumber);
  if (lineage && chain) {
    makeRecord(chain, {
      parentNodeId: lineage.id,
      text: norm,
      producedBy: "inclusion_list_detect",
      position: lineage.position,
      rule: inclusionLists.length
        ? inclusionLists.map((l) => l.classification).join(",")
        : "no_marker_found",
      matched: inclusionLists.length > 0,
      locateFailed: lineage.locateFailed,
    });
  }
  const normForAac = stripInclusionListSpans(norm, inclusionLists);

  const aacList = parseActorActionCondition(normForAac); // L5 AAC — one instruction, or two when a genuine second one is found
  const tps = parseTemporalSignals(text); // L6 TPS
  const sjm = mapJurisdiction(text); // L7 SJM
  const mps = parseMechanism(text); // L8 MPS
  const rds = decomposeRisk(text); // L9 RDS

  return aacList.map((aac, i) => {
    // A split second instruction gets its own signal derived from its own
    // modal word (signalForModal) instead of reusing the whole sentence's L2
    // SSE signal — a sentence with an obligation clause and a prohibition
    // clause would otherwise mislabel whichever clause doesn't match the
    // sentence-wide first-match-wins signal. The first instruction keeps
    // using signals.primary exactly as a single-instruction sentence always
    // has, so that (overwhelmingly common) case is completely unchanged.
    const isSplit = i > 0;
    const signal = isSplit ? signalForModal(aac.modal) : signals.primary;
    const additional = isSplit ? [] : signals.additional;

    // L1 5WIH — L6-L9 (deadlines/jurisdiction/mechanism/enforcement/risk)
    // still run once on the whole sentence text and can't be reliably
    // attributed to one clause or the other, so a split second instruction
    // gets empty values here rather than duplicating the first instruction's
    // onto it — same choice already made for conditions, and the same one
    // renderer.js's clause2Fields makes for the same-actor compound-split case.
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
      where: isSplit ? { jurisdiction: null, system: null, controllingEntity: null } : sjm,
      when: isSplit ? { deadlines: [], triggers: [], sequence: [] } : tps,
      why: { statedReason: null },
      how: isSplit ? { mechanism: null, enforcement: null } : { mechanism: mps.mechanism, enforcement: mps.enforcement },
    };

    const missingSignals = [];
    if (wih.what.action && !wih.who.responsibleParty) {
      missingSignals.push("missing_actor");
    }
    // Scoped to the main clause's own signal only — a subordinate clause's
    // obligation (e.g. "which shall substantially conform to...") doesn't
    // trigger this check for the main clause. Extending missing_enforcement
    // to subordinate clauses is out of scope for this version.
    if (signal === "obligation" && !wih.how.enforcement) {
      missingSignals.push("missing_enforcement");
    }

    const traceReason = signal
      ? `Matched ${signal} signal language in source text`
      : `Matched ${additional[0]?.signal} signal only in a subordinate clause`;

    // L10 ISC
    return {
      sectionType,
      tetherAnchor: {
        type: "text_span",
        sourceSystem: "plain_meaning_pipeline",
        sourceLocation: null,
        anchorText: text,
        sourceDerivedText: norm,
        // Unchanged shape from before this change: zero or one string, element
        // 0 the main clause's signal — this is the frozen `units` input
        // contract (api/openapi.js IscUnit.tetherAnchor), so it stays exactly
        // as external TCS-supplied units already expect it.
        matchedSignals: signal ? [signal] : [],
        // New, additive field — one entry per detected relative clause with its
        // own modal word. Not read anywhere yet; captured so a future version
        // can render or trace these separately. Absent entirely on units
        // supplied via the API's `units` input path, which is fine — every
        // reader of subordinateClauseSignals must treat a missing field the
        // same as an empty array.
        subordinateClauseSignals: additional,
        // New, additive field — one entry per detected including/excluding
        // list, same reasoning as subordinateClauseSignals: attributed only
        // to the first instruction of a split sentence (isSplit ? [] : ...),
        // since a detected list can't be reliably assigned to one clause or
        // the other. Absent entirely on units from the API's `units` input
        // path — every reader must treat a missing field as an empty array.
        inclusionLists: isSplit ? [] : inclusionLists,
        traceReason,
      },
      parse: wih,
      risk: isSplit ? { likelihood: [], consequences: [] } : rds,
      missingSignals,
      controlFlags: [],
      driftDetected: false,
      status: missingSignals.length > 0 ? "incomplete" : "ok",
      lineage: { section: chain ? { records: chain.records } : null, sentence: lineage },
    };
  });
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
  // One sentence can now produce more than one unit (see buildUnit/L5 AAC),
  // so this is a flatMap, not a map+filter — sourceLocation is assigned
  // after flattening since it's a running count across every unit the
  // section produces, not each sentence's own position.
  const units = signalSentences.flatMap((s) => buildUnit(s, sectionType, context.billId || null, chain));
  units.forEach((u, i) => {
    u.tetherAnchor.sourceLocation = `sentence_${i + 1}`;
  });

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
