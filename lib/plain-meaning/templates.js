// ─── Field helpers ────────────────────────────────────────────────────────────

export function cleanActor(actor) {
  if (!actor) return null;
  return actor.replace(/,\s*$/, "").trim();
}

const NUM_PATTERN = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety|one hundred)";
const UNIT_PATTERN = "(?:business\\s+)?(?:days?|months?|years?|hours?|weeks?)";
const TEMPORAL_SUFFIX_RE = new RegExp(
  `\\s+within\\s+${NUM_PATTERN}\\s+${UNIT_PATTERN}[^,;.]*|\\s+no later than\\s+[^;.]{3,60}`,
  "gi"
);

export function cleanAction(action) {
  if (!action) return null;
  return action
    .replace(/^at\s+intervals?\s+[^,]{1,60},\s*/i, "")
    .replace(TEMPORAL_SUFFIX_RE, "")
    .replace(/^,\s*/, "")
    .replace(/[.;,\s]+$/, "")
    .trim() || null;
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

// The no-actor phrasing ("This section {verb}: X") for each template that
// falls back to it. Every caller must use this rather than hardcoding a
// verb: a template that always said "requires" regardless of modal would
// state a prohibition as a requirement. Returns null when modal isn't one
// of the three recognized forces — a caller must not guess a wording for a
// force that wasn't actually detected; it should bail (return null) instead.
function requirementVerb(modal) {
  if (modal === "must") return "requires";
  if (modal === "may") return "allows";
  if (modal === "cannot") return "prohibits";
  return null;
}

// Converts the bare verb stem at the start of an action phrase to its -ing
// form, e.g. "lower the limit" -> "lowering the limit" — "is responsible
// for lower the limit" is ungrammatical; "is responsible for lowering the
// limit" is the natural pairing. Simple suffix rule only (drop a silent
// trailing "e" before adding "ing", except a double "ee" as in "free" ->
// "freeing"); doubling a final consonant ("get" -> "getting") is a known,
// disclosed limitation, not attempted here.
function toGerund(actionText) {
  const spaceIdx = actionText.search(/\s/);
  const verb = spaceIdx === -1 ? actionText : actionText.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : actionText.slice(spaceIdx);
  if (!verb) return actionText;
  const gerundVerb =
    /[^aeiou]e$/i.test(verb) && !/ee$/i.test(verb) ? `${verb.slice(0, -1)}ing` : `${verb}ing`;
  return gerundVerb + rest;
}

// ─── Template functions ───────────────────────────────────────────────────────

export const TEMPLATES = {
  modality_shift({ actor, modal, action, conditions, deadlines, enforcement }) {
    if (!action && !actor) return null;
    const act = cleanAction(action) || "follow this requirement";

    let s;
    if (actor) {
      s = `${cleanActor(actor)} ${modal} ${act}`;
    } else {
      const verb = requirementVerb(modal);
      if (!verb) return null;
      s = `This section ${verb}: ${act}`;
    }
    const cond = firstCondition(conditions);
    if (cond && !alreadyPresent(s, cond)) s += `, ${lowerFirst(cond)}`;
    const dl = firstDeadline(deadlines);
    if (dl && !alreadyPresent(s, dl)) s += `, ${lowerFirst(dl)}`;
    return s;
  },

  actor_power_shift({ actor, modal, action, conditions }) {
    if (!actor) return null;
    const subject = cleanActor(actor);
    const rawAct = cleanAction(action);
    if (!rawAct) return null;

    // Permission ("may") is not a duty — "is responsible for" would invert
    // the meaning (the actor is ALLOWED to act, not REQUIRED to). Render it
    // plainly instead. Deliberately does not strip a "responsible for"
    // prefix here the way the obligation branch below does: that strip
    // exists only to stop OUR OWN "is responsible for" from doubling up
    // with one already in the source text, and doesn't apply when we're
    // not adding that phrase ourselves — "may be responsible for X" is
    // already grammatical as-is. "may only ..." keeps its "only" for free,
    // since "only" lives in the action text, not the modal.
    if (modal === "may") {
      let s = `${subject} may ${rawAct}`;
      const cond = firstCondition(conditions);
      if (cond && !alreadyPresent(s, cond)) s += `, ${lowerFirst(cond)}`;
      return s;
    }

    // Prohibition must never become "is responsible for" — that would state
    // a duty to act where the source forbids acting. This lens was never
    // designed to state a prohibition of its own; bail so renderUnit falls
    // back to plainify() rather than emit a wrong duty.
    if (modal === "cannot") return null;

    // Modal absent or not one of the three recognized forces — never guess
    // a duty when the force wasn't actually detected (same principle
    // requirementVerb above already follows); let renderUnit fall back.
    if (modal !== "must") return null;

    // Strip "be responsible for" / "responsible for" prefix so the template
    // doesn't double up when the source text already contains that phrase
    const act = rawAct
      .replace(/^be\s+responsible\s+for\s+/i, "")
      .replace(/^responsible\s+for\s+/i, "")
      .trim() || null;

    if (!act) return null;
    // A leftover bare passive infinitive ("be construed", "be designated")
    // doesn't pair with "is responsible for" — "is responsible for be
    // construed" is ungrammatical. Bail so renderUnit falls back to plainify().
    if (/^be\s+\w/i.test(act)) return null;
    // "is responsible for <bare verb stem>" ("is responsible for lower...")
    // is ungrammatical — this lens's whole identity is naming who holds
    // responsibility, so the fix is the gerund ("is responsible for
    // lowering..."), not switching to "must lower" (that's modality_shift's
    // job, not this lens's).
    let s = `${subject} is responsible for ${toGerund(act)}`;
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
    const verb = actor ? modal : requirementVerb(modal);
    if (!verb) return null;
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
    const verb = actor ? modal : requirementVerb(modal);
    if (!verb) return null;
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
