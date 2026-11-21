import { captureInput } from "./input.js";
import { indexStructure } from "./structure.js";
import { selectNodes, validateSelection } from "./selection.js";
import { readOrigin } from "./origin.js";
import { routeVerification } from "./verification.js";
import { LENSES, alignProvisions, buildProvisions, collectAuthority, collectReferences, evaluateLens } from "./meaning.js";

export const ARCHITECTURE = "source-anchored-v1";

export async function analyzeLegislation({ documents, afterId, beforeId, lenses = LENSES, alignment = [], selectionRules = {}, lookupAttempts = [] }) {
  if (!Array.isArray(documents) || !documents.length || documents.length > 8) {
    throw new Error("Provide one to eight source documents.");
  }
  if (documents.some(doc => !doc || typeof doc.id !== "string" || !doc.id) ||
    new Set(documents.map(doc => doc.id)).size !== documents.length) throw new Error("Document IDs must be unique strings.");
  if (!Array.isArray(lenses) || lenses.some(lens => !LENSES.includes(lens))) throw new Error("Unknown Meaning lens.");
  if (beforeId && beforeId === (afterId || documents[0].id)) throw new Error("Comparison requires distinct before and after documents.");
  const rules = validateSelection(selectionRules);
  const captured = documents.map(doc => captureInput(doc));
  const structures = captured.map(input => ({ input, structure: indexStructure(input) }));
  const selections = structures.map(document => ({
    ...document, selection: selectNodes(document.structure, rules),
  }));

  const indexed = selections.map(document => {
    const fullProvisions = buildProvisions(document, { useFullIndex: true });
    const selected = new Set(document.selection.entries.map(entry => entry.nodeId));
    return { ...document, fullProvisions, provisions: fullProvisions.filter(provision => selected.has(provision.nodeId)) };
  });
  const after = indexed.find(doc => doc.input.id === (afterId || indexed[0].input.id));
  if (!after) throw new Error("The current document ID was not supplied.");
  const before = indexed.find(doc => doc.input.id === beforeId);
  const references = indexed.flatMap(document => collectReferences(document, document.fullProvisions, indexed));
  const authority = collectAuthority(indexed.flatMap(doc => doc.fullProvisions), references);
  const locationKey = location => JSON.stringify([location.documentId, location.pointer ?? location.start]);
  const byLocation = new Map();
  for (const reference of references) {
    const key = locationKey(reference.locator);
    if (!byLocation.has(key)) byLocation.set(key, []);
    byLocation.get(key).push(reference.id);
  }
  for (const reference of references) {
    reference.nextReferences = [...new Set(reference.targetLocations.flatMap(location =>
      byLocation.get(locationKey(location)) || []
    ))].filter(id => id !== reference.id);
  }
  const pairs = before ? alignProvisions(before, after, alignment)
    : beforeId ? after.provisions.filter(p => p.type === "provision").map(p => ({ before: null, after: p })) : [];
  const context = { references, authority, afterProvisions: after.fullProvisions };
  const resultLenses = await Promise.all([...new Set(lenses)].map(async lens => ({
    lens, findings: pairs.map(pair => evaluateLens(lens, pair, context)),
  })));
  const sections = [...new Set(after.provisions.map(p => p.sectionNumber))];
  const descriptions = after.provisions.map(provision => ({
    provisionId: provision.id, sectionNumber: provision.sectionNumber, locator: provision.locator,
    type: provision.type, text: provision.text, version: provision.version,
    holder: provision.holder, force: provision.force, action: provision.action,
    conditions: [provision.conditionLead, provision.exception].filter(Boolean),
    limits: provision.limits, applicability: provision.applicability,
    renderedText: /^shall(?: not)?$/i.test(provision.modal || "")
      ? provision.text.slice(0, provision.modalOffset) + provision.modal.replace(/^shall/i, "must") +
        provision.text.slice(provision.modalOffset + provision.modal.length)
      : provision.text,
  }));
  // Keep the complete provision. Local substitution preserves qualifiers and
  // leaves compound rules intact when their clause structure is ambiguous.
  const plainMeaning = descriptions.map(description => description.renderedText).join("\n\n");
  return {
    architecture: ARCHITECTURE,
    documents: indexed.map(({ input, structure, selection, provisions }) => ({
      input: { ...input, source: typeof input.source === "string" ? input.source : null },
      structure, selection, provisions,
    })),
    meaning: {
      mode: beforeId ? "comparison" : "description",
      afterId: after.input.id,
      beforeId: beforeId || null,
      contextStatus: beforeId && before?.structure.status !== "indexed" ? "insufficient_context" : "available",
      descriptions, lenses: resultLenses, references, authority,
    },
    origin: indexed.map(doc => readOrigin(doc.input)),
    verification: routeVerification(indexed, references, lookupAttempts),
    plainMeaning, hasContent: descriptions.length > 0,
    sectionTypes: sections.filter(Boolean).map(section => ({
      sectionId: "section_" + section,
      type: after.provisions.some(p => p.sectionNumber === section && p.type === "amendment_instruction")
        ? "amendment" : "standard",
    })),
  };
}
