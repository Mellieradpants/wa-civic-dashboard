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

export function selectNodes(index, rules = {}) {
  if (index.status !== "indexed") return { status: "unavailable", rules, entries: [] };
  const entries = index.nodes.flatMap(node => {
    if (node.kind === "metadata" || !node.text || /^-+\s*END\s*-+\.?$/i.test(node.text)) return [];
    const { firstOrder = 0, lastOrder = Infinity, minimumLength = 0, maximumLength = Infinity, pathPrefix, containsLiteral } = rules;
    if (node.order < firstOrder || node.order > lastOrder) return [];
    if (node.text.length < minimumLength || node.text.length > maximumLength) return [];
    if (pathPrefix && !node.path.startsWith(pathPrefix) && !node.sourcePath.startsWith(pathPrefix)) return [];
    if (containsLiteral && !node.text.includes(containsLiteral)) return [];
    const matched = ["content_node", "nonempty", "not_document_end_marker", ...Object.keys(rules).sort()];
    return [{ nodeId: node.id, reason: matched.join(", ") }];
  });
  return { status: "selected", rules, entries };
}
