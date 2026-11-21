const WA_HOSTS = new Set(["app.leg.wa.gov", "lawfilesext.leg.wa.gov", "wslwebservices.leg.wa.gov"]);

function isWashingtonDocument(input) {
  if (/^(?:WA\s|RCW\s)/i.test(input.instrument || "")) return true;
  if (!input.url) return false;
  try { return WA_HOSTS.has(new URL(input.url).hostname); }
  catch { return false; }
}

function recordRoute(reference, attempts) {
  const externalRcw = /^RCW\s/i.test(reference.target);
  const url = externalRcw
    ? "https://app.leg.wa.gov/RCW/default.aspx?cite=" + encodeURIComponent(reference.target.slice(4).split("(")[0])
    : null;
  const unavailable = url && attempts.some(attempt => attempt.url === url && attempt.status === "unavailable");
  return {
    referenceId: reference.id,
    target: reference.target,
    function: reference.function,
    url,
    status: reference.status === "located" ? "located" : unavailable ? "unavailable" : "not_checked",
    locations: reference.targetLocations,
  };
}

export function routeVerification(documents, references, attempts = []) {
  const byProvision = new Map();
  for (const reference of references) {
    if (!byProvision.has(reference.provisionId)) byProvision.set(reference.provisionId, []);
    byProvision.get(reference.provisionId).push(recordRoute(reference, attempts));
  }
  return documents.flatMap(document => document.provisions.map(provision => {
    const records = byProvision.get(provision.id) || [];
    const type = provision.type === "amendment_instruction" ? "amendment_instruction"
      : provision.force ? "legal_modality"
      : provision.applicability ? "applicability"
      : /\b(?:expire[sd]?|takes? effect|effective date)\b/i.test(provision.text) ? "effective_period"
      : "legislative_statement";
    const jurisdiction = isWashingtonDocument(document.input) ? "Washington State" : "unknown";
    return {
      assertion: provision.text,
      locator: provision.locator,
      type,
      domain: "legislation",
      jurisdiction,
      recordSystem: jurisdiction === "Washington State" ? "Washington State Legislature" : null,
      expectedRecord: records.map(record => record.target).join("; ") || document.input.instrument,
      lookupLocations: records,
      lookFor: type === "amendment_instruction" ? "The cited prior provision and proposed replacement."
        : type === "effective_period" ? "The commencement or expiration provision and its applicable version."
        : "The provision in the identified instrument and any cited authority or exception.",
      lookupStatus: records.length && records.every(record => record.status === "located") ? "located"
        : records.some(record => record.status === "unavailable") ? "unavailable" : "not_checked",
    };
  }));
}
