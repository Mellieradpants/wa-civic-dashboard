import { analyzeLegislation } from "./analyze.js";

const SESSION_CITATION = /RCW\s+(\d+[A-Z]?\.\d+[A-Z]?\.\d+)[\s\S]{0,200}?\band\s+((?:19|20)\d{2}\s+c\s+\d+\s+s\s+\d+)\s+are each (?:reenacted and )?amended/gi;

export async function findPriorSessionLaw(rawHtml, fetchDocument) {
  const text = rawHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  const citations = [...text.matchAll(SESSION_CITATION)];
  // A bill can amend several session laws. Do not treat one as the
  // baseline for the whole bill when the sources differ.
  if (citations.length !== 1) return null;
  const [, rcw, citation] = citations[0];
  const history = await fetchDocument("https://app.leg.wa.gov/RCW/default.aspx?cite=" + rcw);
  for (const link of history.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi)) {
    if (link[2].trim().replace(/\s+/g, " ") !== citation.replace(/\s+/g, " ")) continue;
    const url = new URL(link[1].replaceAll("&amp;", "&"));
    if (url.hostname !== "lawfilesext.leg.wa.gov" || !/\/Pdf\/Bills\/Session(?:%20| )Laws\//i.test(url.pathname)) continue;
    url.pathname = url.pathname.replace(/\/Pdf\//i, "/Htm/").replace(/\.pdf$/i, ".htm");
    url.search = "";
    return url.href;
  }
  return null;
}

export async function analyzeCapturedBill(captured, { billNumber, biennium, beforeUrl, contextUrls = [], fetchDocument, autoRetrieve = true }) {
  const asInput = (doc, id, instrument = null) => ({
    id, source: doc.html, fileType: doc.format, format: doc.format,
    encoding: doc.encoding, url: doc.sourceUrl, version: doc.sourceUrl, instrument,
  });
  const billType = Number(billNumber) < 5000 ? "House" : "Senate";
  const instrument = "WA " + biennium + " " + billType + " " + billNumber;
  const documents = [asInput(captured, "current", instrument)];
  const lookups = [];
  let baseline = beforeUrl;
  if (!baseline && autoRetrieve) {
    try { baseline = await findPriorSessionLaw(captured.html, fetchDocument); }
    catch (error) { lookups.push({ type: "baseline_discovery", status: "unavailable", reason: error.message }); }
  }

  const fetchLinked = async (url, id, type) => {
    try {
      const raw = await fetchDocument(url);
      const rcw = /[?&]cite=([\w.]+)/i.exec(raw.sourceUrl)?.[1];
      const input = asInput(raw, id, rcw ? "RCW " + rcw : "WA session law " + raw.sourceUrl);
      documents.push(input);
      lookups.push({ type, status: "located", url: raw.sourceUrl, documentId: id });
    } catch (error) {
      lookups.push({ type, status: "unavailable", url, reason: error.message });
    }
  };
  if (baseline) await fetchLinked(baseline, "prior", "baseline");
  for (const [index, url] of contextUrls.entries()) await fetchLinked(url, "context-" + (index + 1), "referenced_provision");
  const request = { documents, afterId: "current", beforeId: baseline ? "prior" : undefined };
  let analysis = await analyzeLegislation(request);
  if (autoRetrieve && !contextUrls.length && documents.length < 8) {
    const ids = new Set(analysis.meaning.authority.filter(entry => entry.locator.documentId === "current").flatMap(entry => entry.basis));
    const targets = [...new Set(analysis.meaning.references.filter(reference => ids.has(reference.id) && reference.status === "unresolved")
      .map(reference => reference.target.slice(4).split("(")[0]))].slice(0, 3);
    for (const [index, target] of targets.entries()) {
      await fetchLinked("https://app.leg.wa.gov/RCW/default.aspx?cite=" + target, "auto-context-" + (index + 1), "referenced_provision");
    }
    if (targets.length) analysis = await analyzeLegislation(request);
  }
  return { ...analysis, lookups };
}
