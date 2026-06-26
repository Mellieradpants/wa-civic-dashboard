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

// ─── Template functions ───────────────────────────────────────────────────────

export const TEMPLATES = {
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
    // A leftover bare passive infinitive ("be construed", "be designated")
    // doesn't pair with "is responsible for" — "is responsible for be
    // construed" is ungrammatical. Bail so renderUnit falls back to plainify().
    if (/^be\s+\w/i.test(act)) return null;
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
