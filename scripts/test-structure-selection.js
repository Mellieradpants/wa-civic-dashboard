import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { captureInput } from "../lib/legislation/input.js";
import { indexStructure, locateSourceSpan } from "../lib/legislation/structure.js";
import { selectNodes, validateSelection } from "../lib/legislation/selection.js";

const fixtures = new URL("../data/wa/parser-fixtures/", import.meta.url);
const hb1111 = await readFile(new URL("hb1111.html", fixtures), "utf8");
const hb2108 = await readFile(new URL("hb2108.html", fixtures), "utf8");

function index(format, source, id = format) {
  const input = captureInput({ format, source, id });
  assert.equal(input.status, "accepted", input.issues.join("; "));
  const result = indexStructure(input);
  assert.equal(result.status, "indexed", result.issue);
  return result;
}

function raw(source, range) {
  return source.slice(range.start, range.end);
}

function findRawSpan(source, node, evidence) {
  const slice = raw(source, node.sourceRange);
  const start = slice.indexOf(evidence);
  assert.ok(start >= 0, "Expected evidence in the original node slice");
  return locateSourceSpan(node, start, start + evidence.length);
}

test("Saved Washington bills produce deterministic, source-anchored indexes and selections", () => {
  for (const [id, source] of [["1111", hb1111], ["2108", hb2108]]) {
    const result = index("html", source, id);
    const again = index("html", source, id);
    assert.deepEqual(again, result);
    const ids = new Set(result.nodes.map(node => node.id));
    assert.equal(ids.size, result.nodes.length);
    for (const [order, node] of result.nodes.entries()) {
      assert.equal(node.order, order);
      assert.equal(node.sourceRange.documentId, id);
      assert.ok(node.sourceRange.start >= 0 && node.sourceRange.end <= source.length);
      assert.ok(raw(source, node.sourceRange).length > 0);
      assert.deepEqual(node.locator, node.sourceRange);
      for (const parent of [node.sourceParentId, node.documentParentId]) {
        assert.ok(parent === null || ids.has(parent));
      }
    }
    const rules = validateSelection({ pathPrefix: "/section-2", minimumLength: 10 });
    const snapshot = structuredClone(result);
    const selection = selectNodes(result, rules);
    assert.deepEqual(selection, selectNodes(again, rules));
    assert.deepEqual(result, snapshot);
    assert.equal(selection.entries.length + selection.excluded.length, result.nodes.length);
    assert.equal(new Set([...selection.entries, ...selection.excluded].map(entry => entry.nodeId)).size, ids.size);
  }
});

test("HB 1111 retains source containment, legislative relationships, and precise amendment evidence", () => {
  const result = index("html", hb1111, "1111");
  const byPath = path => result.nodes.find(node => node.documentPath === path);
  const heading = byPath("/section-2");
  const petition = byPath("/section-2/item-1");
  const renumbered = byPath("/section-2/item-7");
  assert.equal(petition.documentParentId, heading.id);
  assert.equal(petition.sourceParentId, null);
  assert.equal(petition.sourceParentPath, heading.sourceParentPath);
  assert.notEqual(petition.sourceParentPath, heading.sourcePath);

  const deletion = '<span style="text-decoration:line-through;">serving no less than 20 years of total confinement</span>';
  const addition = '<span style="text-decoration:underline;">reaching the age of 24 or older</span>';
  for (const evidence of [deletion, addition]) {
    assert.equal(raw(hb1111, findRawSpan(hb1111, petition, evidence)), evidence);
  }
  assert.deepEqual(renumbered.numbering, { text: "(((6)))(7)", previous: ["6"], current: ["7"] });
  assert.deepEqual(renumbered.outline, ["7"]);
  assert.match(raw(hb1111, renumbered.sourceRange), /line-through/);
  assert.throws(() => locateSourceSpan(petition, -1, 1), RangeError);
  assert.throws(() => locateSourceSpan(petition, 0, petition.sourceRange.end - petition.sourceRange.start + 1), RangeError);

  const section = byPath("/section-3");
  const a = byPath("/section-3/item-1/item-a");
  const b = byPath("/section-3/item-1/item-b");
  const expiry = byPath("/section-3/item-2");
  assert.equal(a.documentParentId, section.id);
  assert.equal(b.documentParentId, section.id);
  assert.equal(expiry.documentParentId, section.id);
  assert.match(expiry.text, /This section expires July 1, 2035/);
  const selection = selectNodes(result);
  assert.ok(selection.entries.some(entry => entry.nodeId === expiry.id));
  assert.equal(selection.excluded.find(entry => entry.nodeId === result.nodes.at(-1).id).reason, "document_end_marker");
});

test("Compound labels keep sibling subsections and reuse an existing numbered parent", () => {
  const withImplicitParent = index("text", "Sec. 1. Outline.\n(1)(a) First.\n(b) Second.\n(i) Nested.\n(2) Next.");
  const [section, a, b, roman, next] = withImplicitParent.nodes;
  assert.deepEqual(a.outline, ["1", "a"]);
  assert.deepEqual(b.outline, ["1", "b"]);
  assert.equal(a.documentParentId, section.id);
  assert.equal(b.documentParentId, section.id);
  assert.deepEqual(roman.outline, ["1", "b", "i"]);
  assert.equal(roman.documentParentId, b.id);
  assert.deepEqual(next.outline, ["2"]);
  assert.equal(next.documentParentId, section.id);

  const withIndexedParent = index("text", "Sec. 1. Outline.\n(1) Lead-in.\n(1)(a) First.\n(b) Second.");
  const [, numbered, repeated, sibling] = withIndexedParent.nodes;
  assert.equal(repeated.documentParentId, numbered.id);
  assert.equal(sibling.documentParentId, numbered.id);
  assert.ok(withIndexedParent.nodes.every(node => node.sourceParentId === null));
});

test("HTML, XML, JSON and text expose explicit boundaries and original spans", () => {
  const fixtures = {
    html: ['<!doctype html><section><p>Sec. 1.</p><p>(1) The <em>board</em> may act.<br>(a) Unless ordered otherwise.</p></section>', "html-element"],
    xml: ['<bill><heading>Sec. 1.</heading><rule>(1) The <em>board</em> may act.</rule><rule>(2) Next.</rule></bill>', "xml-element"],
    json: ['{"body":{"heading":"Sec. 1.","a/b":"(1) The board may act.\\n(a) Unless ordered otherwise.","count":1}}', "json-string"],
    text: ["Sec. 1.\r\n\r\n(1) The board may act.\r\n(a) Unless ordered otherwise.", "text-line"],
  };
  const results = {};
  for (const [format, [source, expectedBoundary]] of Object.entries(fixtures)) {
    const result = index(format, source);
    assert.ok(result.nodes.some(node => node.boundary === expectedBoundary));
    for (const node of result.nodes) {
      assert.equal(typeof node.sourcePath, "string");
      assert.equal(typeof node.documentPath, "string");
      assert.ok(Array.isArray(node.outline));
      assert.ok(node.sourceRange.start >= 0 && node.sourceRange.end <= source.length);
      const whole = locateSourceSpan(node, 0, node.sourceRange.end - node.sourceRange.start);
      assert.equal(whole.documentId, format);
      assert.ok(raw(source, whole).length > 0);
    }
    results[format] = result.nodes;
  }

  const [root, heading, rule, inline, nextRule] = results.xml;
  assert.equal(rule.sourceParentId, root.id);
  assert.equal(rule.documentParentId, heading.id);
  assert.equal(inline.sourceParentId, rule.id);
  assert.equal(rule.path, nextRule.path);
  assert.notEqual(rule.sourcePath, nextRule.sourcePath);
  assert.equal(rule.text, "(1) The  may act.");

  const json = results.json.find(node => node.locator.pointer === "/body/a~1b");
  assert.equal(json.sourceParentPath, "/body");
  const escapedNewline = findRawSpan(fixtures.json[0], json, "\\n");
  assert.equal(raw(fixtures.json[0], escapedNewline), "\\n");
  assert.equal(results.text[1].sourcePath, "/line-3");

  const literal = { containsLiteral: "The board may act." };
  assert.equal(selectNodes({ status: "indexed", nodes: results.html }, literal).entries.length, 1);
  assert.equal(selectNodes({ status: "indexed", nodes: results.xml }, literal).entries.length, 0);
});

test("Path rules use complete segments on both hierarchies", () => {
  const result = index("text", "Sec. 1. First.\n(1) A rule.\n(a) A condition.\nSec. 10. Tenth.\n(1) Other rule.");
  const selection = selectNodes(result, { pathPrefix: "/section-1" });
  assert.deepEqual(selection.entries.map(entry => entry.nodeId), result.nodes.slice(0, 3).map(node => node.id));
  assert.deepEqual(selection.excluded.map(entry => entry.reason), ["pathPrefix", "pathPrefix"]);

  const json = index("json", '{"a":{"key":"One"},"ab":{"key":"Two"},"a/b":"Three"}');
  const picked = selectNodes(json, { pathPrefix: "/a" });
  assert.deepEqual(picked.entries.map(entry => entry.nodeId), [json.nodes[2].id]);
});

test("Selection records the first failed rule without altering any evidence", () => {
  const result = index("json", '{"title":"Metadata","blank":"   ","end":" --- END --- ","small":"x","large":"a very long value","other":"other","match":"permit"}');
  const snapshot = structuredClone(result);
  const rules = validateSelection({ minimumLength: 2, maximumLength: 7, containsLiteral: "permit" });
  const selection = selectNodes(result, rules);
  assert.deepEqual(selection.excluded.map(entry => entry.reason),
    ["empty_text", "metadata", "empty_text", "document_end_marker", "minimumLength", "maximumLength", "containsLiteral"]);
  assert.deepEqual(selection.entries, [{
    nodeId: result.nodes.at(-1).id,
    reason: "content_node, nonempty, not_document_end_marker, containsLiteral, maximumLength, minimumLength",
  }]);
  assert.deepEqual(result, snapshot);
  const order = selectNodes(result, { firstOrder: 6, lastOrder: 6 });
  assert.deepEqual(order.entries.map(entry => entry.nodeId), [result.nodes[6].id]);
  assert.ok(order.excluded.some(entry => entry.reason === "firstOrder"));
  assert.ok(order.excluded.some(entry => entry.reason === "lastOrder"));
  assert.deepEqual(selectNodes({ status: "failed", nodes: [] }), {
    status: "unavailable", rules: {}, entries: [], excluded: [],
  });
});
