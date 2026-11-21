import { parse } from "parse5";
import { SaxesParser } from "saxes";

const HTML_BLOCKS = new Set(["div", "p", "li", "h1", "h2", "h3", "h4", "td", "pre", "blockquote"]);
const SKIP_HTML = new Set(["head", "script", "style", "template"]);
const HEADING = /^(?:(NEW SECTION\.)\s*)?Sec\.\s+(\d+)\.\s*/i;
const OUTLINE = /^((?:\([a-z0-9]+\)\s*)+)/i;
const DELETED_OUTLINE = /^\(\(\s*\(([a-z0-9]+)\)\s*\)\)\s*/i;
const PROVENANCE_FIELD = /^(?:title|headline|author|publisher|datePublished|publicationTime|account)$/i;

function htmlBlocks(source) {
  const tree = parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true });
  const blocks = [];
  function visit(node, sourcePath, sourceParentPath) {
    if (SKIP_HTML.has(node.tagName)) return;
    const location = node.sourceCodeLocation;
    const isText = node.nodeName === "#text";
    if (location && (isText || HTML_BLOCKS.has(node.tagName) && !containsBlock(node))) {
      const text = (isText ? node.value : htmlText(node)).trim();
      if (text) blocks.push({
        text, start: location.startOffset, end: location.endOffset, sourcePath, sourceParentPath,
        boundary: isText ? "html-text" : "html-element",
      });
      return;
    }
    (node.childNodes || []).forEach((child, index) =>
      visit(child, sourcePath + "/" + child.nodeName + "[" + index + "]", sourcePath));
  }

  function findContentWrapper(node, sourcePath, sourceParentPath) {
    if ((node.attrs || []).some(attr => attr.name === "id" && attr.value === "contentWrapper")) {
      return { node, sourcePath, sourceParentPath };
    }
    for (const [index, child] of (node.childNodes || []).entries()) {
      const result = findContentWrapper(child, sourcePath + "/" + child.nodeName + "[" + index + "]", sourcePath);
      if (result) return result;
    }
    return null;
  }

  const scope = findContentWrapper(tree, "/#document", null);
  if (scope) visit(scope.node, scope.sourcePath, scope.sourceParentPath);
  else visit(tree, "/#document", null);
  return blocks.sort((a, b) => a.start - b.start);
}

function containsBlock(node) {
  return (node.childNodes || []).some(child => HTML_BLOCKS.has(child.tagName) || containsBlock(child));
}

function htmlText(node) {
  if (node.nodeName === "#text") return node.value;
  if (SKIP_HTML.has(node.tagName)) return "";
  if (node.tagName === "br") return "\n";
  return (node.childNodes || []).map(htmlText).join("");
}

function textBlocks(source) {
  const blocks = [];
  let line = 0;
  for (const match of source.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    line++;
    const raw = match[0].replace(/(?:\r\n|\n|\r)$/, "");
    if (raw.trim()) blocks.push({
      text: raw.trim(), start: match.index, end: match.index + raw.length,
      sourcePath: "/line-" + line, sourceParentPath: null, boundary: "text-line",
    });
  }
  return blocks;
}

function xmlBlocks(source) {
  const blocks = [];
  const stack = [];
  const parser = new SaxesParser({ xmlns: true });
  let start = 0;
  parser.on("opentagstart", () => { start = source.lastIndexOf("<", parser.position - 1); });
  parser.on("opentag", tag => {
    const frame = stack.at(-1);
    const parent = frame?.block;
    const position = frame ? frame.nextChild++ : 0;
    const sourceParentPath = parent?.sourcePath ?? null;
    const block = {
      name: tag.name, parent, start, text: "", boundary: "xml-element", sourceParentPath,
      sourcePath: (sourceParentPath || "") + "/" + tag.name + "[" + position + "]",
    };
    blocks.push(block);
    stack.push({ block, nextChild: 0 });
  });
  const append = text => { if (stack.length) stack.at(-1).block.text += text; };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    const { block } = stack.pop();
    block.end = parser.position;
    block.text = block.text.trim();
  });
  parser.write(source).close();
  return blocks;
}

function jsonBlocks(source) {
  // JSON.parse has already validated the grammar. Walk its lexical order
  // here because Object.keys sorts integer keys ahead of other properties.
  const tokens = [...source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)];
  const blocks = [];
  let cursor = 0;
  function visit(path, parent) {
    const token = tokens[cursor++];
    const object = token[0] === "{";
    const array = token[0] === "[";
    const string = token[0][0] === '"';
    const block = {
      pointer: path, parent, start: token.index, end: token.index + token[0].length,
      text: string ? JSON.parse(token[0]) : "",
      sourcePath: path, sourceParentPath: parent?.sourcePath ?? null,
      boundary: object ? "json-object" : array ? "json-array" : string ? "json-string" : "json-scalar",
    };
    blocks.push(block);
    if (!object && !array) return;
    const close = object ? "}" : "]";
    const keys = new Set();
    let index = 0;
    while (tokens[cursor][0] !== close) {
      const key = object ? JSON.parse(tokens[cursor++][0]) : String(index++);
      if (object) cursor++;
      if (keys.has(key)) throw new Error("Duplicate JSON key has an ambiguous source pointer: " + key);
      keys.add(key);
      visit(path + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"), block);
      if (tokens[cursor][0] === ",") cursor++;
    }
    const terminator = tokens[cursor++];
    block.end = terminator.index + terminator[0].length;
  }
  visit("", null);
  return blocks;
}

function outlinePrefix(text) {
  let rest = text;
  const previous = [];
  for (let match = DELETED_OUTLINE.exec(rest); match; match = DELETED_OUTLINE.exec(rest)) {
    previous.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  const prefix = OUTLINE.exec(rest)?.[1] ?? "";
  const current = [...prefix.matchAll(/\(([^)]+)\)/g)].map(match => match[1]);
  if (!previous.length && !current.length) return null;
  return { text: text.slice(0, text.length - rest.length + prefix.length).trimEnd(), previous, current };
}

function markerDepth(marker, outline) {
  if (/^\d+$/.test(marker)) return 1;
  if (/^(?:ii|iii|iv|vi|vii|viii|ix|x)$/i.test(marker)) return 3;
  if (/^i$/i.test(marker) && outline.length >= 2 && !/^h$/i.test(outline[1].marker)) return 3;
  return 2;
}

function nearestOutlineNode(outline) {
  for (let i = outline.length - 1; i >= 0; i--) {
    if (outline[i].node) return outline[i].node;
  }
  return null;
}

// start/end are UTF-16 offsets relative to the original source slice for the
// node, not offsets in its decoded or flattened text.
export function locateSourceSpan(node, start, end) {
  const range = node?.sourceRange;
  if (!range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end > range.end - range.start) {
    throw new RangeError("Span must fall within the node's original source range.");
  }
  return { documentId: range.documentId, start: range.start + start, end: range.start + end };
}

export function indexStructure(input) {
  if (input.status !== "accepted") return { status: "unavailable", nodes: [] };
  const nodes = [];
  try {
    const read = { text: textBlocks, html: htmlBlocks, xml: xmlBlocks, json: jsonBlocks }[input.format];
    const blocks = read(input.source);
    const outline = [];
    const nodeByBlock = new Map();
    const ordinals = new Map();
    let section = null;
    let inBody = input.format !== "html" || !blocks.some(block => /BE IT ENACTED BY THE LEGISLATURE/i.test(block.text));

    for (const block of blocks) {
      const { text } = block;
      const metadataField = (input.format === "json" && PROVENANCE_FIELD.test(block.pointer.split("/")[1] || "")) ||
        (input.format === "xml" && PROVENANCE_FIELD.test(block.name || ""));
      const documentBoundary = /BE IT ENACTED BY THE LEGISLATURE/i.test(text);
      const heading = inBody && !metadataField ? HEADING.exec(text) : null;
      const kind = heading ? "section" : inBody && !documentBoundary && !metadataField ? "content" : "metadata";
      if (heading) {
        outline.length = 0;
        ordinals.clear();
      }

      const numbering = kind === "metadata" ? null : outlinePrefix(heading ? text.slice(heading[0].length) : text);
      const markers = numbering?.current ?? [];
      let newMarkers = markers;
      if (markers.length) {
        const first = Math.min(outline.length, markerDepth(markers[0], outline) - 1);
        let reused = 0;
        // A compound label can repeat already-indexed ancestors. Keep those
        // parents, but always make the last marker the new node.
        while (reused < markers.length - 1 && outline[first + reused]?.marker === markers[reused]) reused++;
        outline.length = first + reused;
        newMarkers = markers.slice(reused);
      }
      const documentParent = kind === "content" ? nearestOutlineNode(outline) || section : null;
      const currentOutline = kind === "metadata" ? [] : [...outline.map(frame => frame.marker), ...newMarkers];
      const outlineKey = currentOutline.join("/");
      const sourceParent = nodeByBlock.get(block.parent);
      const sectionNumber = heading?.[2] ?? (kind === "content" ? section?.sectionNumber ?? null : null);
      const slot = heading ? "sec:" + heading[2] : markers.length ? outlineKey : documentParent?.slot ?? "root";
      const count = ordinals.get(slot) || 0;
      ordinals.set(slot, count + 1);

      const order = nodes.length;
      const documentPath = heading ? "/section-" + heading[2]
        : markers.length ? (section?.documentPath || "") + currentOutline.map(marker => "/item-" + marker).join("")
        : (documentParent?.documentPath || "") + "/block-" + (order + 1);
      const formatPath = block.pointer ?? (block.name ? (sourceParent?.path || "") + "/" + block.name : null);
      const sourceRange = { documentId: input.id, start: block.start, end: block.end };
      const node = {
        id: input.id + ":n" + (order + 1),
        order,
        boundary: block.boundary,
        sourceParentId: sourceParent?.id ?? null,
        sourceParentPath: block.sourceParentPath,
        sourcePath: block.sourcePath,
        documentParentId: documentParent?.id ?? null,
        documentPath,
        outline: currentOutline,
        numbering,
        parentId: sourceParent?.id ?? documentParent?.id ?? null,
        path: formatPath ?? documentPath,
        sourceRange,
        locator: block.pointer !== undefined ? { documentId: input.id, pointer: block.pointer } : sourceRange,
        kind,
        sectionNumber,
        marker: markers.at(-1) ?? null,
        slot: slot + ":" + count,
        text,
      };
      nodes.push(node);
      nodeByBlock.set(block, node);
      if (heading) section = node;
      newMarkers.forEach((marker, i) => outline.push({ marker, node: i === newMarkers.length - 1 ? node : null }));
      if (documentBoundary) inBody = true;
    }
    return { status: "indexed", nodes };
  } catch (error) {
    return { status: "failed", issue: error.message, nodes: [] };
  }
}
