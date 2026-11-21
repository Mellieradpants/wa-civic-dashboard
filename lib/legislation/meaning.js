export const LENSES = [
  "modality_shift", "applicability_change", "allocation_of_power",
  "governed_action_change", "threshold_change", "duty_effect",
];

const AMENDMENT = /^(.*?)(?:\s+(?:is|are)(?: each)?(?: reenacted and)? amended to read as follows:)/i;
const MODAL = /\b(shall not|must not|may not|cannot|is prohibited from|shall|must|is required to|are required to|may|is authorized to|has (?:the )?authority to|is delegated authority to)\b/i;
const DUTY_EXCEPT = /\b(?:except(?: that| for)?|unless|does not apply to|provided(?: that)?)\b/i;
const LIMITS = /\b(?:after|before|within|at least|at most|no (?:less|more|later) than|over|up to|exceeds?|reaching)\s+[^;,]*?\b(?:\d[\d,.]*|one|two|three|five|ten|twenty|thirty)\s*(?:percent|years?(?: of total confinement)?|months?|days?|hours?|dollars?|or older|of age|(?=[;,.]|$))|\$\s*[\d,.]+/gi;
const RCW_CITATIONS = /\b(?:RCW\s+)(\d+[A-Z]?\.\d+[A-Z]?\.\d+(?:\([a-z0-9]+\))*)(?:\s*(?:,|or|and|through)\s*(\d+[A-Z]?\.\d+[A-Z]?\.\d+(?:\([a-z0-9]+\))*)\b)*/gi;

function removeStrikeouts(text) {
  let output = "";
  for (let index = 0; index < text.length; index++) {
    if (text.slice(index, index + 2) !== "((") {
      output += text[index];
      continue;
    }
    let depth = 2;
    let cursor = index + 2;
    while (cursor < text.length && depth) {
      if (text[cursor] === "(") depth++;
      if (text[cursor] === ")") depth--;
      cursor++;
    }
    if (depth) return output + text.slice(index);
    index = cursor - 1;
  }
  return output;
}

function clean(text) {
  return removeStrikeouts(text).replace(/\s+/g, " ").trim();
}

function normalize(text) {
  return text?.toLowerCase().replace(/[.\s]+$/g, "").trim() || null;
}

function citationKey(citation) {
  return citation.toUpperCase().replace(/^RCW\s*/i, "").replace(/\s+/g, "");
}

function sectionTarget(node) {
  const text = clean(node.text).replace(/^(?:NEW SECTION\.\s*)?Sec\.\s+\d+\.\s*/i, "");
  const instruction = AMENDMENT.exec(text);
  return instruction ? /\bRCW\s+(\d+[A-Z]?\.\d+[A-Z]?\.\d+)/i.exec(instruction[1])?.[1].toUpperCase() : null;
}

function splitClauses(text) {
  // Keep list lead-ins and their items together. Split only when a new
  // clause has both a subject and its own modal.
  const independent = /(?:;\s+|,\s+but\s+|[.!?]\s+)(?=(?:The |A |An |Any |No |Each |Every |It |They |We |This |If |When |\w+'s )[^\n;:.]{1,100}\b(?:shall|must|may|cannot|is required to|has the authority to)\b)/gi;
  const clauses = [];
  let start = 0;
  for (const boundary of text.matchAll(independent)) {
    const end = boundary.index + (/^[.!?;]/.test(boundary[0]) ? 1 : 0);
    clauses.push(text.slice(start, end).trim());
    start = boundary.index + boundary[0].length;
  }
  clauses.push(text.slice(start).trim());
  return clauses.filter(Boolean);
}

function readClause(text, locator, nodeId) {
  const modal = MODAL.exec(text.replace(/\bMay\s+(?=\d)/g, "    "));
  const holder = modal ? text.slice(0, modal.index).replace(/^(?:If|When|Unless|Notwithstanding)\b[^,]*,\s*/i, "").trim() : null;
  const force = modal
    ? /not$|cannot|prohibited/.test(modal[0].toLowerCase()) ? "prohibited"
      : /may|authorit|authorized/.test(modal[0].toLowerCase()) ? "permitted" : "required"
    : null;
  const action = modal ? text.slice(modal.index + modal[0].length).trim() : null;
  const exception = DUTY_EXCEPT.exec(action || "");
  const conditionLead = /^(?:if|when|unless|except|subject to)\b[^,]+/i.exec(text)?.[0] ?? null;
  const applicability = /\b(?:does not apply to|applies to)\s+([^.;]+)/i.exec(text)?.[0] ?? null;
  const decisionTest = /\b(?:if|when)\s+(?:the\s+)?(?:court|board|department|agency|commission)\s+(?:finds|determines)\s+[^;,.]+/i.exec(text)?.[0] ?? null;
  const coreAction = action?.split(/[,;:]?\s+(?:after|before|within|no later than|provided(?: that)?|unless|except|pursuant to|under RCW|as authorized by|subject to|with (?:the )?(?:consent|approval) of)\b/i, 1)[0] || null;
  const limits = [...text.matchAll(LIMITS)].map(match => match[0].trim());
  if (decisionTest) limits.push(decisionTest);
  return {
    text, nodeId, locator, holder, force, action, coreAction, limits,
    modal: modal?.[0] ?? null, modalOffset: modal?.index ?? null, conditionLead, applicability,
    threshold: limits.length ? limits : null,
    exception: exception ? action.slice(exception.index) : /^(?:unless|except)/i.test(conditionLead || "") ? conditionLead : null,
    grant: modal && /\bauthority\b|authorized to/i.test(modal[0]),
    delegation: modal && /delegated/i.test(modal[0]),
  };
}

export function buildProvisions(document, { useFullIndex = false } = {}) {
  const selected = new Set(document.selection.entries.map(entry => entry.nodeId));
  const sections = new Map();
  const provisions = [];
  for (const node of document.structure.nodes) {
    if (node.kind === "section") sections.set(node.sectionNumber, sectionTarget(node));
    if (useFullIndex ? node.kind === "metadata" : !selected.has(node.id)) continue;
    const text = clean(node.text).replace(/^-+\s*END\s*-+\.?$/i, "");
    if (!text) continue;
    const target = sections.get(node.sectionNumber) || (/^RCW\s/i.test(document.input.instrument || "") ? citationKey(document.input.instrument) : null);
    const heading = /^(?:NEW SECTION\.\s*)?Sec\.\s+\d+\.\s*/i.exec(text);
    let content = heading ? text.slice(heading[0].length) : text;
    const amendment = node.kind === "section" ? AMENDMENT.exec(content) : null;
    if (amendment) {
      provisions.push({
        ...readClause(amendment[0], node.locator, node.id),
        id: node.id + ":instruction", type: "amendment_instruction", target,
        sectionNumber: node.sectionNumber, outline: null, version: document.input.version,
      });
      content = content.slice(amendment[0].length);
    }
    content = content.replace(/^(?:\([a-z0-9]+\)\s*)+/i, "").trim();
    const clauses = splitClauses(content);
    clauses.forEach((clause, index) => {
      provisions.push({
        ...readClause(clause, node.locator, node.id),
        id: node.id + ":p" + (index + 1),
        type: "provision",
        target,
        sectionNumber: node.sectionNumber,
        outline: node.marker ? node.slot.replace(/:\d+$/, "") + ":" + index : null,
        version: document.input.version,
      });
    });
  }
  return provisions;
}

export function collectReferences(document, provisions, context) {
  const known = new Map();
  for (const candidate of context) {
    for (const provision of candidate.fullProvisions) {
      if (provision.target && provision.type === "provision") {
        const key = citationKey(provision.target);
        if (!known.has(key)) known.set(key, []);
        known.get(key).push(provision.locator);
      }
    }
  }
  const references = [];
  for (const provision of provisions) {
    for (const match of provision.text.matchAll(RCW_CITATIONS)) {
      const parts = [...match[0].matchAll(/\d+[A-Z]?\.\d+[A-Z]?\.\d+(?:\([a-z0-9]+\))*/gi)];
      for (const part of parts) {
        const target = citationKey(part[0]);
        const base = target.split("(")[0];
        const prefix = provision.text.slice(0, match.index).slice(-105);
        const explicitBasis = /\b(?:pursuant to|authorized by|authority under|as authorized under|in accordance with|under)\s*$/i.test(prefix) && !/\b(?:imposed|convicted|sentenced|released|defined|found|approved)\s+under\s*$/i.test(prefix) && !/\b(?:offender|person) (?:is )?entitled to a hearing/i.test(prefix);
        const purpose = provision.type === "amendment_instruction" ? "amendment_target"
          : /with\s+(?:the\s+)?(?:approval|consent)\s+of|\bapproved\s+(?:under|by)\s*$|entitled to a hearing pursuant to\s*$/i.test(prefix) ? "procedural_approval"
          : explicitBasis ? "enabling_provision"
          : "cross_reference";
        const instrument = document.input.instrument;
        const internal = Boolean(instrument && citationKey(instrument) === base);
        const supplied = (known.get(base) || []).filter(location => {
          const source = context.find(candidate => candidate.input.id === location.documentId);
          if (internal) return location.documentId === document.input.id;
          if (purpose === "amendment_target" && location.documentId === "prior" && location.documentId !== document.input.id) return true;
          return /^RCW\s/i.test(source?.input.instrument || "");
        });
        const targets = target === base ? supplied : supplied.filter(location => {
          const candidate = context.find(item => item.input.id === location.documentId);
          const node = candidate?.structure.nodes.find(item => item.locator === location);
          return node?.marker === target.match(/\(([^)]+)\)/)?.[1];
        });
        references.push({
          id: provision.id + ":ref" + (references.length + 1),
          instrument, provisionId: provision.id, passage: part[0], target: "RCW " + target,
          function: purpose, scope: instrument ? internal ? "internal" : "external" : "unknown",
          locator: provision.locator, targetLocations: targets,
          status: targets.length ? "located" : "unresolved",
        });
      }
    }
    for (const match of provision.text.matchAll(/\b(?:this section|subsection\s+\([a-z0-9]+\)\s+of this section)\b/gi)) {
      const marker = match[0].match(/\(([^)]+)\)/)?.[1];
      const targets = document.structure.nodes.filter(node => node.sectionNumber === provision.sectionNumber &&
        (marker ? node.marker === marker : node.kind === "section"));
      references.push({
        id: provision.id + ":ref" + (references.length + 1),
        instrument: document.input.instrument, provisionId: provision.id, passage: match[0],
        target: provision.sectionNumber ? "Sec. " + provision.sectionNumber + (marker ? "(" + marker + ")" : "") : match[0],
        function: "cross_reference", scope: "internal", locator: provision.locator,
        targetLocations: targets.map(node => node.locator), status: targets.length ? "located" : "unresolved",
      });
    }
  }
  return references;
}

export function collectAuthority(provisions, references) {
  return provisions.flatMap(provision => {
    if (!provision.holder || provision.force !== "permitted") return [];
    const basis = references.filter(ref => ref.provisionId === provision.id && ref.function === "enabling_provision");
    const approval = /\b(?:with|upon)\s+(?:the\s+)?(?:consent|approval)\s+of\s+([^,;.]*)/i.exec(provision.text);
    if (!provision.grant && !basis.length && !approval && !/\b(?:board|agency|department|commission|court|secretary|director|governor|authority|officer)\b/i.test(provision.holder)) return [];
    const kind = provision.delegation ? "delegation" : provision.grant ? "grant" : basis.length ? "exercise" : "authorization";
    return [{
      id: provision.id + ":authority", provisionId: provision.id, kind,
      designation: { provisionId: provision.id, locator: provision.locator, target: provision.target },
      holder: provision.holder, holderPassage: { text: provision.holder, locator: provision.locator },
      power: provision.coreAction, locator: provision.locator,
      basis: basis.map(ref => ref.id), basisTargets: basis.map(ref => ref.target),
      basisStatus: basis.length ? basis.every(ref => ref.status === "located") ? "located" : "unresolved" : "not_stated",
      approvals: approval ? [{ holder: approval[1].trim(), passage: approval[0], locator: provision.locator }] : [],
    }];
  });
}

export function alignProvisions(before, after, explicitPairs) {
  const left = before.fullProvisions.filter(p => p.type === "provision");
  const selectedBefore = new Set(before.provisions.map(provision => provision.id));
  const right = after.provisions.filter(p => p.type === "provision");
  const pairs = [];
  const used = new Set();
  const findLeft = (next) => {
    const explicit = explicitPairs?.find(pair => pair.after === next.id);
    if (explicit) return left.find(previous => previous.id === explicit.before && !used.has(previous.id));
    const available = left.filter(previous => !used.has(previous.id));
    const sameInstrument = before.input.instrument && before.input.instrument === after.input.instrument;
    const matchingTarget = available.filter(previous => next.target ? previous.target === next.target :
      sameInstrument && previous.sectionNumber === next.sectionNumber && !previous.target);
    const matches = matchingTarget.filter(previous => next.outline && previous.outline === next.outline);
    const exact = available.filter(previous => normalize(previous.text) === normalize(next.text) &&
      (next.target ? previous.target === next.target : previous.sectionNumber === next.sectionNumber));
    if (exact.length === 1) return exact[0];
    if (matches.length === 1) return matches[0];
    return undefined;
  };
  for (const next of right) {
    const previous = findLeft(next);
    if (previous) used.add(previous.id);
    pairs.push({ before: previous ?? null, after: next });
  }
  const targets = new Set(right.map(p => p.target).filter(Boolean));
  for (const previous of left.filter(p => selectedBefore.has(p.id) && !used.has(p.id) && (!targets.size || targets.has(p.target)))) pairs.push({ before: previous, after: null });
  return pairs;
}

function result(lens, pair, status, details = {}) {
  return {
    id: lens + ":" + (pair.after?.id || pair.before?.id),
    lens, status,
    provisions: { before: pair.before?.id ?? null, after: pair.after?.id ?? null },
    versions: { before: pair.before?.version ?? null, after: pair.after?.version ?? null },
    locations: { before: pair.before?.locator ?? null, after: pair.after?.locator ?? null },
    ...details,
  };
}

export function evaluateLens(lens, pair, context) {
  const { before, after } = pair;
  const missing = reason => result(lens, pair, "insufficient_context", { reason });
  const unchanged = () => result(lens, pair, "no_change_found");
  const change = (beforeValue, afterValue, details = {}) => result(lens, pair, "supported", {
    before: beforeValue, after: afterValue, ...details,
  });
  if (!before || !after || !before.version || !after.version) {
    return missing("Both identifiable, aligned versions are required. Unpaired text may be relocated or restated.");
  }

  const sameHolder = normalize(before.holder) === normalize(after.holder);
  const sameAction = Boolean(before.coreAction && normalize(before.coreAction) === normalize(after.coreAction));
  const related = context.references.filter(ref => ref.provisionId === before.id || ref.provisionId === after.id);
  const oldAuthority = context.authority.find(entry => entry.provisionId === before.id);
  const newAuthority = context.authority.find(entry => entry.provisionId === after.id);
  const unresolvedBasis = related.some(ref => ref.function === "enabling_provision" && ref.status !== "located");
  const oldBasis = oldAuthority?.basisTargets || [];
  const newBasis = newAuthority?.basisTargets || [];
  const sameBasis = JSON.stringify(oldBasis) === JSON.stringify(newBasis);

  if (lens === "allocation_of_power") {
    if (oldAuthority && newAuthority && sameAction && !sameBasis) {
      return change(oldBasis, newBasis, {
        kind: "cited_basis_changed", holder: after.holder, power: after.coreAction,
        contextStatus: unresolvedBasis ? "insufficient_context" : "located",
      });
    }
    if (unresolvedBasis) return missing("The cited enabling provision has not been located.");
    if (oldAuthority && newAuthority && sameAction && !sameHolder &&
      oldAuthority.kind !== "exercise" && newAuthority.kind !== "exercise") {
      return change(before.holder, after.holder, { kind: "holder_changed", power: after.coreAction });
    }
    if (oldAuthority && newAuthority && !sameAction) return missing("The respective powers could not be matched.");
    if (!sameHolder && (oldAuthority || newAuthority)) return missing("The respective powers could not be matched.");
    return unchanged();
  }

  if (lens === "modality_shift") {
    if (!sameAction || !sameHolder || !before.force || !after.force) {
      return normalize(before.text) === normalize(after.text) ? unchanged() : missing("Could not isolate the same holder and action.");
    }
    return before.force === after.force ? unchanged() : change(before.force, after.force);
  }

  if (lens === "applicability_change") {
    if (before.exception !== after.exception && sameHolder && sameAction && (before.exception || after.exception)) {
      return change(before.exception, after.exception, {
        kind: "condition_or_exception_changed",
        cause: JSON.stringify(before.limits) === JSON.stringify(after.limits) ? null : "threshold_change:" + after.id,
      });
    }
    if (before.applicability !== after.applicability && (before.applicability || after.applicability)) {
      return change(before.applicability, after.applicability, { kind: "explicit_scope_changed" });
    }
    if (sameAction && sameHolder && before.conditionLead !== after.conditionLead) {
      return change(before.conditionLead, after.conditionLead, { kind: "condition_changed" });
    }
    if (sameAction && sameHolder && JSON.stringify(before.limits) !== JSON.stringify(after.limits)) {
      return change(before.limits, after.limits, { kind: "threshold_coverage_changed", cause: "threshold_change:" + after.id });
    }
    if (!sameHolder && sameAction && before.holder && after.holder && !oldAuthority && !newAuthority) {
      return change(before.holder, after.holder, { kind: "covered_holder_changed" });
    }
    return normalize(before.text) === normalize(after.text) || sameAction && sameHolder
      ? unchanged() : missing("Coverage could not be isolated from other changes.");
  }

  if (lens === "governed_action_change") {
    if (sameAction || normalize(before.text) === normalize(after.text)) return unchanged();
    if (sameHolder && before.coreAction && after.coreAction) return change(before.coreAction, after.coreAction);
    return missing("Could not isolate the governed actions for a common holder.");
  }

  if (lens === "threshold_change") {
    if (JSON.stringify(before.limits) === JSON.stringify(after.limits)) {
      return normalize(before.text) === normalize(after.text) || sameAction ? unchanged()
        : missing("Could not isolate a comparable cutoff or decision test.");
    }
    if (sameAction && sameHolder) return change(before.limits, after.limits);
    return missing("Cutoffs were found, but the provisions could not be matched by holder and action.");
  }

  if (lens === "duty_effect") {
    if (unresolvedBasis) return missing("Dependent duty effects require the cited enabling provision.");
    if (sameAction && sameHolder && before.force && after.force) {
      if (before.force !== "required" && after.force === "required") {
        return change(before.force, after.force, { effect: "created", cause: "modality_shift:" + after.id });
      }
      if (before.force === "required" && after.force !== "required") {
        const restated = context.afterProvisions.some(p => p.id !== after.id && p.force === "required" &&
          normalize(p.holder) === normalize(before.holder) && normalize(p.coreAction) === normalize(before.coreAction));
        return restated ? missing("A matching duty appears elsewhere in the revised material.")
          : change(before.force, after.force, { effect: "ended", cause: "modality_shift:" + after.id });
      }
      if (before.force === "required" && after.force === "required" && before.exception !== after.exception) {
        const isException = value => !value || /^(?:except|unless|does not apply)/i.test(value);
        if (isException(before.exception) && isException(after.exception) && (!before.exception || !after.exception)) {
          return change(before.exception, after.exception, {
            effect: before.exception ? "extended" : "narrowed", cause: "applicability_change:" + after.id,
          });
        }
        return missing("The direction of the duty effect depends on the changed conditions.");
      }
      return unchanged();
    }
    return normalize(before.text) === normalize(after.text) ? unchanged()
      : missing("A baseline duty and its revised treatment could not be established.");
  }
  throw new Error("Unsupported lens: " + lens);
}
