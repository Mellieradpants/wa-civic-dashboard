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
  /\bshall\b|\bmust\b|\brequired to\b|\bis required\b|\bare required\b|\bobligated to\b|\bis responsible for\b|\bare responsible for\b/i;
const PERMISSION_RE =
  /(?<!\bmay not\b.{0,20})\bmay\b(?!\s+not\b)|\bpermitted to\b|\bauthorized to\b|\bis allowed\b/i;

function detectSignal(text) {
  if (PROHIBITION_RE.test(text)) return "prohibition";
  if (OBLIGATION_RE.test(text)) return "obligation";
  if (PERMISSION_RE.test(text)) return "permission";
  return null;
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

function extractSignalSentences(text) {
  return splitSentences(text)
    .map((s) => ({ text: s, signal: detectSignal(s) }))
    .filter((s) => s.signal !== null);
}

// ─── L3: CFS — Constraint Filter ─────────────────────────────────────────────

const BLOCKED = [
  /\bintends?\s+to\b/i,
  /\bseeks?\s+to\b/i,
  /\baims?\s+to\b/i,
  /\bdesigned\s+to\b/i,
  /\bpurpose\s+is\s+to\b/i,
];

function passesConstraintFilter(text) {
  return !BLOCKED.some((p) => p.test(text));
}

// ─── L5: AAC — Actor-Action-Condition Parsing ─────────────────────────────────

const MODAL_RE =
  /\b(is no longer required to|are no longer required to|is responsible for|are responsible for|shall not|must not|may not|shall|must|may|cannot|is required to|are required to)\b/i;

function parseActorActionCondition(text) {
  const norm = normalize(text);
  const modalMatch = norm.match(MODAL_RE);

  let actor = null;
  let modal = null;
  let action = null;

  if (modalMatch) {
    const idx = modalMatch.index;
    actor = norm.slice(0, idx).replace(/,\s*$/, "").trim() || null;
    modal = modalMatch[0].trim().toLowerCase();
    action = norm
      .slice(idx + modalMatch[0].length)
      .replace(/[.;]+$/, "")
      .trim() || null;
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

// ─── L1: 5WIH + L10: ISC — Assemble ─────────────────────────────────────────

function buildUnit(sentenceObj, sourceIndex) {
  const { text, signal } = sentenceObj;

  if (!passesConstraintFilter(text)) return null; // L3 CFS

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
      actors: aac.actor ? [aac.actor] : [],
      responsibleParty: aac.actor,
      decisionAuthority: signal === "permission" ? aac.actor : null,
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
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function runPipeline(rawText) {
  const text = String(rawText || "").trim();
  const signalSentences = extractSignalSentences(text); // L2 SSE
  const units = signalSentences
    .map((s, i) => buildUnit(s, i))
    .filter(Boolean);

  return {
    inputLength: text.length,
    sentenceCount: signalSentences.length,
    unitCount: units.length,
    units,
  };
}
