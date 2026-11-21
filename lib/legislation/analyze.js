import { captureInput, indexStructure, selectNodes } from "./evidence.js";
import { LENSES, alignProvisions, buildProvisions, collectAuthority, collectReferences, evaluateLens } from "./meaning.js";

export const ARCHITECTURE = "source-anchored-v1";

function origin(input) {
  const values = new Map();
  const distribution = [];
  const add = (field, value, signal, locator = null) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!values.has(field)) values.set(field, []);
    values.get(field).push({ value: value.trim(), signal, locator });
  };
  if (input.url) {
    try { add("site", new URL(input.url).hostname, "fetched_url"); } catch { /* unparseable observed URL */ }
    add("sourceUrl", input.url, "adapter");
  }
  add("contentType", input.format, "adapter");
  const source = typeof input.source === "string" ? input.source : "";
  const locator = match => ({ documentId: input.id, start: match.index, end: match.index + match[0].length });
  if (input.format === "html") {
    for (const match of source.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)) add("title", match[1], "html_title", locator(match));
    for (const match of source.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
      const attrs = Object.fromEntries([...match[0].matchAll(/\b([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map(part => [part[1].toLowerCase(), part[2] ?? part[3] ?? part[4]]));
      if (attrs.rel?.toLowerCase() === "canonical") add("canonicalUrl", attrs.href, "canonical_link", locator(match));
      const name = (attrs.property || attrs.name || "").toLowerCase();
      if (/^(?:og|twitter):/.test(name) && attrs.content) distribution.push({ name, value: attrs.content, locator: locator(match) });
      const field = { author: "author", publisher: "publisher", date: "publicationTime", "article:published_time": "publicationTime" }[name];
      if (field) add(field, attrs.content, "html_meta:" + name, locator(match));
    }
    for (const match of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(match[1]);
        for (const node of [].concat(data["@graph"] || data)) {
          add("title", node.headline || node.name, "json_ld", locator(match));
          for (const author of [].concat(node.author || [])) add("author", author?.name || author, "json_ld", locator(match));
          add("publisher", node.publisher?.name || node.publisher, "json_ld", locator(match));
          add("publicationTime", node.datePublished, "json_ld", locator(match));
          add("contentType", node["@type"], "json_ld", locator(match));
        }
      } catch { /* malformed provenance hints supply no observed fields */ }
    }
  }
  const fields = {};
  for (const name of ["site", "sourceUrl", "canonicalUrl", "title", "author", "publisher", "publicationTime", "contentType"]) {
    const observations = values.get(name) || [];
    fields[name] = {
      state: !observations.length ? "missing" : new Set(observations.map(item => item.value)).size > 1 ? "conflicting" : "observed",
      observations,
    };
  }
  return { documentId: input.id, fields, distribution };
}

function routeVerification(documents, references) {
  const asserted = documents.flatMap(document => document.provisions.map(provision => {
    const authority = references.filter(ref => ref.provisionId === provision.id);
    const type = provision.type === "amendment_instruction" ? "amendment_instruction"
      : provision.force ? "legal_modality" : "legislative_statement";
    const jurisdiction = document.input.instrument ? "Washington State" : "unknown";
    const system = jurisdiction === "Washington State" ? "Washington State Legislature" : null;
    return {
      assertion: provision.text, locator: provision.locator, type, jurisdiction,
      domain: "legislation", recordSystem: system,
      expectedRecord: authority.map(ref => ref.target).join("; ") || document.input.instrument,
      lookupLocations: authority.filter(ref => /^RCW /i.test(ref.target)).map(ref => ({ target: ref.target,
        url: "https://app.leg.wa.gov/RCW/default.aspx?cite=" + encodeURIComponent(ref.target.slice(4).split("(")[0]),
        status: ref.status === "located" ? "located" : "not_checked",
      })),
      lookFor: type === "amendment_instruction" ? "The cited prior provision and the proposed replacement."
        : "The provision in the identified instrument and any cited authority or exception.",
      lookupStatus: authority.length && authority.every(ref => ref.status === "located") ? "located"
        : "not_checked",
    };
  }));
  return asserted;
}

export async function analyzeLegislation({ documents, afterId, beforeId, lenses = LENSES, alignment = [] }) {
  if (!Array.isArray(documents) || !documents.length || documents.length > 8) {
    throw new Error("Provide one to eight source documents.");
  }
  if (documents.some(doc => !doc || typeof doc.id !== "string" || !doc.id) ||
    new Set(documents.map(doc => doc.id)).size !== documents.length) throw new Error("Document IDs must be unique strings.");
  if (!Array.isArray(lenses) || lenses.some(lens => !LENSES.includes(lens))) throw new Error("Unknown Meaning lens.");
  if (beforeId && beforeId === (afterId || documents[0].id)) throw new Error("Comparison requires distinct before and after documents.");
  const indexed = documents.map(doc => {
    const input = captureInput(doc);
    const structure = indexStructure(input);
    const selection = selectNodes(structure);
    const document = { input, structure, selection };
    return { ...document, provisions: buildProvisions(document) };
  });
  const after = indexed.find(doc => doc.input.id === (afterId || indexed[0].input.id));
  if (!after) throw new Error("The current document ID was not supplied.");
  const before = indexed.find(doc => doc.input.id === beforeId);
  const references = indexed.flatMap(document => collectReferences(document, document.provisions, indexed));
  const authority = collectAuthority(indexed.flatMap(doc => doc.provisions), references);
  for (const reference of references) {
    reference.nextReferences = references.filter(next => reference.targetLocations.some(location =>
      location.documentId === next.locator.documentId && location.start === next.locator.start && location.pointer === next.locator.pointer
    ) && next.id !== reference.id).map(next => next.id);
  }
  const pairs = before ? alignProvisions(before, after, alignment)
    : after.provisions.filter(p => p.type === "provision").map(p => ({ before: null, after: p }));
  const context = { references, authority, afterProvisions: after.provisions };
  const resultLenses = await Promise.all([...new Set(lenses)].map(async lens => ({
    lens, findings: pairs.map(pair => evaluateLens(lens, pair, context)),
  })));
  const sections = [...new Set(after.provisions.map(p => p.sectionNumber))];
  const descriptions = after.provisions.map(provision => ({
    provisionId: provision.id, sectionNumber: provision.sectionNumber, locator: provision.locator,
    type: provision.type, text: provision.text,
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
    origin: indexed.map(doc => origin(doc.input)),
    verification: routeVerification(indexed, references),
    plainMeaning, hasContent: descriptions.length > 0,
    sectionTypes: sections.filter(Boolean).map(section => ({
      sectionId: "section_" + section,
      type: after.provisions.some(p => p.sectionNumber === section && p.type === "amendment_instruction")
        ? "amendment" : "standard",
    })),
  };
}
