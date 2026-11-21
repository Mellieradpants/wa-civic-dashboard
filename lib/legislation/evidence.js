import { parse } from "parse5";
import { SaxesParser } from "saxes";

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const FORMATS = new Set(["text", "html", "json", "xml"]);
const HTML_BLOCKS = new Set(["div", "p", "li", "h1", "h2", "h3", "h4", "td", "pre", "blockquote"]);
const SKIP_HTML = new Set(["head", "script", "style", "template"]);
const HEADING = /^(?:(NEW SECTION\.)\s*)?Sec\.\s+(\d+)\.\s*/i;
const OUTLINE = /^((?:\([a-z0-9]+\)\s*)+)/i;

export function captureInput({ id, source, format, encoding = "utf-8", url = null, instrument = null, version = null }) {
  const input = { id, source, format, encoding, url, instrument, version, status: "accepted", issues: [] };
  const reject = (status, message) => Object.assign(input, { status, issues: [message] });

  if (typeof source !== "string") return reject("malformed", "Expected a decoded source string.");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) return reject("too_large", "Document exceeds the 4 MiB decoded-input limit.");
  if (!FORMATS.has(format) || !/^utf-8$/i.test(encoding)) {
    return reject("unsupported", "Input must be UTF-8 text, HTML, XML, or JSON.");
  }
  try {
    if (format === "json") JSON.parse(source);
    if (format === "xml") {
      const parser = new SaxesParser({ xmlns: true });
      parser.on("doctype", () => { throw new Error("XML document type declarations are unsupported."); });
      parser.write(source).close();
    }
    if (format === "html") {
      input.issues = htmlErrors(source);
      if (input.issues.length) input.status = "malformed";
    }
  } catch (error) {
    reject("malformed", error.message);
  }
  return input;
}

function htmlErrors(source) {
  const issues = [];
  parse(source, {
    scriptingEnabled: false,
    onParseError(error) {
      if (error.code !== "missing-doctype") issues.push(error.code + " at offset " + error.startOffset);
    },
  });
  return issues;
}

function htmlBlocks(source) {
  const tree = parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true });
  const blocks = [];
  function visit(node) {
    if (SKIP_HTML.has(node.tagName)) return;
    if (node.nodeName === "#text" && node.sourceCodeLocation) {
      const { startOffset: start, endOffset: end } = node.sourceCodeLocation;
      if (node.value.trim()) blocks.push({ text: node.value.trim(), start, end });
      return;
    }
    if (HTML_BLOCKS.has(node.tagName) && node.sourceCodeLocation && !containsBlock(node)) {
      const { startOffset: start, endOffset: end } = node.sourceCodeLocation;
      const text = htmlText(node).trim();
      if (text) blocks.push({ text, start, end });
      return;
    }
    for (const child of node.childNodes || []) visit(child);
  }
  const locateRcwBody = node => (node.attrs || []).some(attr => attr.name === "id" && attr.value === "contentWrapper")
    ? node : (node.childNodes || []).map(locateRcwBody).find(Boolean);
  visit(locateRcwBody(tree) || tree);
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
  return [...source.matchAll(/[^\r\n]+/g)]
    .filter(match => match[0].trim())
    .map(match => ({ text: match[0].trim(), start: match.index, end: match.index + match[0].length }));
}

function xmlBlocks(source) {
  const blocks = [];
  const stack = [];
  const parser = new SaxesParser({ xmlns: true });
  let start = 0;
  parser.on("opentagstart", () => { start = source.lastIndexOf("<", parser.position - 1); });
  parser.on("opentag", tag => {
    const block = { name: tag.name, parent: stack.at(-1), start, text: "" };
    blocks.push(block);
    stack.push(block);
  });
  const append = text => { if (stack.length) stack.at(-1).text += text; };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    const block = stack.pop();
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
    const block = { pointer: path, parent, text: token[0][0] === '"' ? JSON.parse(token[0]) : "", name: path.split("/").at(-1) };
    blocks.push(block);
    if (token[0] !== "{" && token[0] !== "[") return;
    const object = token[0] === "{";
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
    cursor++;
  }
  visit("", null);
  return blocks;
}

export function indexStructure(input) {
  if (input.status !== "accepted") return { status: "unavailable", nodes: [] };
  const nodes = [];
  try {
    const read = { text: textBlocks, html: htmlBlocks, xml: xmlBlocks, json: jsonBlocks }[input.format];
    const blocks = read(input.source);
    const ancestors = [];
    const nodeByBlock = new Map();
    const ordinals = new Map();
    let section = null;
    let inBody = input.format !== "html" || !blocks.some(b => /BE IT ENACTED BY THE LEGISLATURE/i.test(b.text));
    for (const block of blocks) {
      const text = block.text;
      const documentBoundary = /BE IT ENACTED BY THE LEGISLATURE/i.test(text);
      const heading = HEADING.exec(text);
      const sectionHeading = heading && (inBody || input.format !== "html");
      const outlineText = (sectionHeading ? text.slice(heading[0].length) : text).replace(/^\(\(\([a-z0-9]+\)\)\)\s*/i, "");
      const outline = OUTLINE.exec(outlineText)?.[1];
      const markers = outline ? [...outline.matchAll(/\(([^)]+)\)/g)].map(m => m[1]) : [];
      const depth = markers.length > 1 ? 1 : markerDepth(markers[0], ancestors);
      if (sectionHeading) {
        ancestors.length = 0;
        ordinals.clear();
      }
      if (markers.length) ancestors.length = Math.min(ancestors.length, depth - 1);
      const structuralParent = nodeByBlock.get(block.parent);
      const parent = structuralParent || (sectionHeading ? null : ancestors.at(-1) || section);
      const path = block.pointer ?? (block.name ? (parent?.path || "") + "/" + block.name : parent?.path || "");
      const wrappedSection = sectionHeading ? heading[2] : section?.sectionNumber ?? null;
      const markerPath = markers.length ? [...ancestors.map(n => n.marker), ...markers].join("/") : null;
      const slot = (sectionHeading ? "sec:" + heading[2] : markerPath || (parent?.slot ?? "root"));
      const count = ordinals.get(slot) || 0;
      ordinals.set(slot, count + 1);
      const node = {
        id: input.id + ":n" + (nodes.length + 1),
        order: nodes.length,
        parentId: parent?.id ?? null,
        path: block.pointer ?? (path + (block.name ? "" : "/" + (sectionHeading ? "section-" + heading[2] : (markerPath ? "item-" + markerPath.replaceAll("/", "-") : "block-" + (nodes.length + 1))))),
        locator: block.pointer !== undefined
          ? { documentId: input.id, pointer: block.pointer }
          : { documentId: input.id, start: block.start, end: block.end },
        kind: sectionHeading ? "section" : inBody && !documentBoundary ? "content" : "metadata",
        sectionNumber: wrappedSection,
        marker: markers.at(-1) ?? null,
        slot: slot + ":" + count,
        text,
      };
      nodes.push(node);
      nodeByBlock.set(block, node);
      if (sectionHeading) section = node;
      if (markers.length) ancestors.push(node);
      if (documentBoundary) inBody = true;
    }
    return { status: "indexed", nodes };
  } catch (error) {
    return { status: "failed", issue: error.message, nodes: [] };
  }
}

function markerDepth(marker, ancestors) {
  if (!marker || /^\d+$/.test(marker)) return 1;
  if (/^(?:ii|iii|iv|vi|vii|viii|ix|x)$/.test(marker)) return 3;
  if (marker === "i" && ancestors.length >= 2 && ancestors[1].marker !== "h") return 3;
  return 2;
}

export function selectNodes(index) {
  const entries = index.nodes.flatMap(node => {
    if (node.kind === "metadata" || !node.text || /^-+\s*END\s*-+\.?$/i.test(node.text)) return [];
    return [{ nodeId: node.id, reason: "Nonempty text at a document content path." }];
  });
  return { entries };
}
