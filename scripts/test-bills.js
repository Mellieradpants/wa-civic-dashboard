import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import billText from "../api/wa-bill-text.js";
import plainMeaning from "../api/plain-meaning.js";

const fixtures = new URL("../data/wa/parser-fixtures/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", fixtures)));
const responses = new Map(await Promise.all(Object.values(manifest).map(async info => {
  const body = await readFile(new URL(info.file, fixtures));
  assert.equal(createHash("sha256").update(body).digest("hex"), info.sha256, info.file);
  return [info.url, { ...info, body }];
})));

async function request(handler, req) {
  let code;
  let result;
  const res = {
    setHeader() {},
    status(value) { code = value; return this; },
    json(value) { result = value; },
  };
  await handler(req, res);
  assert.equal(code, 200, JSON.stringify(result));
  return result;
}

async function getBill(billNumber, query = {}) {
  const response = await request(billText, { method: "GET", query: { billNumber, biennium: "2025-26", ...query } });
  assert.equal(response.analysis.architecture, "source-anchored-v1");
  return response.analysis;
}

function analyze(body) {
  return request(plainMeaning, { method: "POST", body });
}

function locate(result, location) {
  assert.ok(location);
  const { input } = result.documents.find(doc => doc.input.id === location.documentId);
  assert.ok(Number.isInteger(location.start) && location.start >= 0 && location.end > location.start);
  assert.ok(location.end <= input.source.length);
  return input.source.slice(location.start, location.end);
}

function latest(result) {
  return result.documents.find(doc => doc.input.id === result.meaning.afterId);
}

function finding(result, lens, provision, status = "supported") {
  const entry = result.meaning.lenses.find(item => item.lens === lens);
  return entry.findings.find(item => item.status === status && item.provisions.after === provision.id);
}

function assertAuthority(result) {
  const authority = result.meaning.authority.find(item => item.power === "impose sanctions" && item.locator.documentId === "current");
  assert.ok(authority, "Expected the HB 2108 court sanctions authority");
  assert.equal(authority.holder, "the court");
  assert.equal(authority.holderPassage.text, "the court");
  assert.match(locate(result, authority.holderPassage.locator), /the court may impose sanctions/);
  assert.equal(authority.kind, "exercise");
  assert.equal(authority.basis.length, 1, "The court's cited legal basis must be linked");
  const reference = result.meaning.references.find(item => item.id === authority.basis[0]);
  assert.equal(reference.target, "RCW 13.40.200");
  assert.equal(reference.function, "enabling_provision");
  assert.equal(reference.scope, "external");
  assert.equal(reference.status, "located", "The cited provision must be available");
  assert.ok(reference.targetLocations.some(location =>
    /\b(?:modify|sanction|confinement|fails to comply)\b/i.test(locate(result, location))));
  assert.ok(result.meaning.references.some(item =>
    item.target === "RCW 13.40.165" && item.function === "amendment_target" && item.scope === "external"));
  return authority;
}

// No fixture test can fall back to the network, including linked lookups.
globalThis.fetch = async url => {
  const info = responses.get(String(url));
  if (!info) throw new Error("Unrecorded fixture request: " + url);
  return new Response(info.body, { status: info.status, headers: { "content-type": info.contentType } });
};

test("HB 1111 compares petition eligibility against the cited 2024 session law", async () => {
  const result = await getBill("1111");
  const current = latest(result);
  assert.equal(result.meaning.mode, "comparison");
  assert.equal(result.lookups.find(lookup => lookup.type === "baseline").url, manifest["laws-2024-ch118"].url);
  const petition = current.provisions.find(item =>
    item.target === "9.94A.730" && item.coreAction === "petition the indeterminate sentence review board for early release");
  assert.equal(petition.force, "permitted");
  const threshold = finding(result, "threshold_change", petition);
  assert.deepEqual(threshold.before, ["after serving no less than 20 years of total confinement"]);
  assert.deepEqual(threshold.after, ["after reaching the age of 24 or older"]);
  assert.equal(threshold.versions.before, manifest["laws-2024-ch118"].url);
  assert.equal(threshold.versions.after, manifest.hb1111.url);
  assert.match(locate(result, threshold.locations.before), /20<\/span> years of total confinement/);
  assert.match(locate(result, threshold.locations.after), /reaching the age of 24 or older/);
  assert.equal(finding(result, "applicability_change", petition).cause, threshold.id);
  assert.ok(finding(result, "modality_shift", petition, "no_change_found"));
  assert.ok(finding(result, "duty_effect", petition, "no_change_found"));
  assert.match(result.plainMeaning, /This section expires July 1, 2035\./);
  assert.ok(current.provisions.some(item => item.type === "amendment_instruction" && item.target === "9.94A.730"));
});

test("HB 2108 preserves the court, power, cited authority, and original documents", async () => {
  const options = { retrieve: "false", contextUrl: manifest["rcw-13.40.200"].url };
  const result = await getBill("2108", options);
  const authority = assertAuthority(result);
  assert.match(result.plainMeaning, /The tool must be designed to limit bias/);
  const duty = latest(result).provisions.find(item => item.text.includes("The tool must be designed to limit bias"));
  assert.match(locate(result, duty.locator), /The tool must be designed to limit bias/);

  const withoutContext = await getBill("2108", { retrieve: "false" });
  assert.equal(withoutContext.meaning.authority.find(item => item.id === authority.id).basisStatus, "unresolved");
  assert.throws(() => assertAuthority(withoutContext), /cited provision must be available/);
  assert.match(withoutContext.plainMeaning, /court may impose sanctions/);

  const withoutLink = structuredClone(result);
  withoutLink.meaning.authority.find(item => item.id === authority.id).basis = [];
  assert.throws(() => assertAuthority(withoutLink), /cited legal basis must be linked/);
});

test("An amendment instruction remains available when the prior version is withheld", async () => {
  const raw = await getBill("1111", { retrieve: "false" });
  const input = latest(raw).input;
  const result = await analyze({ documents: [input], beforeId: "prior" });
  assert.equal(result.meaning.contextStatus, "insufficient_context");
  assert.ok(result.meaning.descriptions.some(entry => entry.type === "amendment_instruction" && entry.text.includes("9.94A.730")));
  assert.ok(result.meaning.lenses.every(lens =>
    lens.findings.length && lens.findings.every(item => item.status === "insufficient_context")));
});

test("Identical inputs are deterministic and each lens agrees with the full run", async () => {
  const result = await getBill("1111");
  const documents = result.documents.map(doc => doc.input);
  const input = { documents, beforeId: "prior", afterId: "current" };
  const full = await analyze(input);
  assert.deepEqual(await analyze(input), full);
  for (const lens of full.meaning.lenses) {
    const single = await analyze({ ...input, lenses: [lens.lens] });
    assert.deepEqual(single.meaning.lenses, [lens]);
  }
  for (const doc of full.documents) {
    const ids = new Set(doc.structure.nodes.map(node => node.id));
    assert.equal(ids.size, doc.structure.nodes.length);
    for (const [order, node] of doc.structure.nodes.entries()) {
      assert.equal(node.order, order);
      assert.ok(node.parentId === null || ids.has(node.parentId));
      assert.ok(locate(full, node.locator));
    }
    assert.ok(doc.selection.entries.every(item => ids.has(item.nodeId) && item.reason));
  }
});

function textDocument(id, source, instrument = "RCW 1.2.3") {
  return { id, source, instrument, version: id + "-version", format: "text" };
}

async function compare(before, after, additions = []) {
  const documents = [
    textDocument("before", "Sec. 1. Scope.\n(1) " + before),
    textDocument("after", "Sec. 1. Scope.\n(1) " + after),
    ...additions,
  ];
  const result = await analyze({ documents, beforeId: "before", afterId: "after" });
  const provision = latest(result).provisions.find(item => item.outline === "1:0");
  return { result, provision };
}

test("The six lenses distinguish changes, linked effects, and dependency gaps", async () => {
  let c = await compare("The agency may file the report.", "The agency must file the report.");
  const modality = finding(c.result, "modality_shift", c.provision);
  assert.deepEqual([modality.before, modality.after], ["permitted", "required"]);
  assert.equal(finding(c.result, "duty_effect", c.provision).cause, modality.id);

  c = await compare("The agency must file the report except during a closure.", "The agency must file the report.");
  const applicability = finding(c.result, "applicability_change", c.provision);
  assert.equal(applicability.before, "except during a closure.");
  assert.equal(finding(c.result, "duty_effect", c.provision).effect, "extended");
  assert.equal(finding(c.result, "duty_effect", c.provision).cause, applicability.id);

  c = await compare("The agency must file the report.", "The agency must publish the report.");
  assert.equal(finding(c.result, "governed_action_change", c.provision).after, "publish the report.");

  c = await compare("The board is authorized to issue permits.", "The department is authorized to issue permits.");
  assert.equal(finding(c.result, "allocation_of_power", c.provision).kind, "holder_changed");

  c = await compare("The board may issue permits pursuant to RCW 4.5.6.", "The board may issue permits pursuant to RCW 4.5.7.");
  assert.equal(finding(c.result, "allocation_of_power", c.provision).kind, "cited_basis_changed");
  assert.equal(finding(c.result, "allocation_of_power", c.provision).contextStatus, "insufficient_context");
  assert.ok(finding(c.result, "duty_effect", c.provision, "insufficient_context"));

  c = await compare("The board may issue permits pursuant to RCW 4.5.6.", "The board may issue permits pursuant to RCW 4.5.6.", [
    textDocument("authority", "The board is authorized to issue permits pursuant to RCW 5.6.7.", "RCW 4.5.6"),
    textDocument("delegation", "The department is delegated authority to set the permit standard.", "RCW 5.6.7"),
  ]);
  const reference = c.result.meaning.references.find(item => item.provisionId === c.provision.id);
  assert.equal(reference.status, "located");
  assert.ok(reference.nextReferences.some(id =>
    c.result.meaning.references.some(item => item.id === id && item.target === "RCW 5.6.7" && item.status === "located")));
  assert.ok(finding(c.result, "allocation_of_power", c.provision, "no_change_found"));
});

test("Intake validates each format and preserves source, node order and provenance conflicts", async () => {
  const documents = [
    textDocument("text", "The agency must file the report."),
    { id: "json", format: "json", source: '{"label":"The agency may act.","2":"second","1":"third"}' },
    { id: "xml", format: "xml", source: "<root><clause>The agency must act.</clause><empty/></root>" },
    { id: "html", format: "html", url: "https://example.org/doc", source:
      "<!doctype html><title>Bill A</title><meta name='author' content='Alice'><meta property='og:title' content='Distribution title'><script type='application/ld+json'>{\"author\":{\"name\":\"Bob\"}}</script><p>The agency may act.</p>" },
    { id: "broken-json", format: "json", source: '{"broken":}' },
    { id: "broken-xml", format: "xml", source: "<root><missing></root>" },
    { id: "broken-html", format: "html", source: "<p attribute='" },
    { id: "unsupported", format: "pdf", source: "%PDF" },
  ];
  const result = await analyze({ documents });
  assert.deepEqual(result.documents.map(doc => doc.input.status),
    ["accepted", "accepted", "accepted", "accepted", "malformed", "malformed", "malformed", "unsupported"]);
  assert.equal(result.documents[4].input.source, '{"broken":}');
  assert.deepEqual(result.documents[1].structure.nodes.map(node => node.locator.pointer), ["", "/label", "/2", "/1"]);
  const [, clause] = result.documents[2].structure.nodes;
  assert.equal(locate(result, clause.locator), "<clause>The agency must act.</clause>");
  assert.equal(result.origin[3].fields.author.state, "conflicting");
  assert.equal(result.origin[3].distribution[0].value, "Distribution title");
  assert.ok(result.documents[3].provisions.every(item => !item.text.includes("Distribution title")));
});
