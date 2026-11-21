export function validateSelection(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new Error("Selection rules must be an object.");
  const allowed = new Set(["firstOrder", "lastOrder", "minimumLength", "maximumLength", "pathPrefix", "containsLiteral"]);
  for (const [key, value] of Object.entries(rules)) {
    if (!allowed.has(key)) throw new Error("Unsupported selection rule: " + key);
    const textRule = key === "pathPrefix" || key === "containsLiteral";
    if (textRule ? typeof value !== "string" || !value : !Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid selection rule value: " + key);
    }
  }
  if (rules.firstOrder > rules.lastOrder || rules.minimumLength > rules.maximumLength) {
    throw new Error("Selection rule minimum exceeds its maximum.");
  }
  return rules;
}

function matchesPath(path, prefix) {
  return path === prefix || path.startsWith(prefix + "/");
}

export function selectNodes(index, rules = {}) {
  const entries = [];
  const excluded = [];
  if (index.status !== "indexed") return { status: "unavailable", rules, entries, excluded };

  const { firstOrder = 0, lastOrder = Infinity, minimumLength = 0, maximumLength = Infinity, pathPrefix, containsLiteral } = rules;
  const matched = ["content_node", "nonempty", "not_document_end_marker", ...Object.keys(rules).sort()].join(", ");
  for (const node of index.nodes) {
    const trimmed = node.text.trim();
    let reason;
    if (node.kind === "metadata") reason = "metadata";
    else if (!trimmed) reason = "empty_text";
    else if (/^-+\s*END\s*-+\.?$/i.test(trimmed)) reason = "document_end_marker";
    else if (node.order < firstOrder) reason = "firstOrder";
    else if (node.order > lastOrder) reason = "lastOrder";
    else if (node.text.length < minimumLength) reason = "minimumLength";
    else if (node.text.length > maximumLength) reason = "maximumLength";
    else if (pathPrefix && ![node.documentPath, node.sourcePath, node.path].some(path => matchesPath(path, pathPrefix))) reason = "pathPrefix";
    else if (containsLiteral && !node.text.includes(containsLiteral)) reason = "containsLiteral";

    if (reason) excluded.push({ nodeId: node.id, reason });
    else entries.push({ nodeId: node.id, reason: matched });
  }
  return { status: "selected", rules, entries, excluded };
}
