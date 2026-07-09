const DOCUMENT_SEARCH_BASE = "https://app.leg.wa.gov/bi/tld/documentsearchresults";

function findHtmlDocumentUrl(html, billNumber) {
  const matches = [...String(html).matchAll(/<a[^>]+href="([^"]+)"[^>]*>/gi)];
  for (const [, href] of matches) {
    const url = href.replace(/&amp;/g, "&");
    if (/\.html?(\?|$)/i.test(url) && url.includes(billNumber)) {
      return url.startsWith("http") ? url : `https://app.leg.wa.gov${url}`;
    }
  }
  return null;
}

async function check(billNumber, biennium) {
  const searchUrl = `${DOCUMENT_SEARCH_BASE}?${new URLSearchParams({ biennium, documentType: "1", name: billNumber })}`;
  const searchRes = await fetch(searchUrl, { headers: { Accept: "text/html, */*" } });
  console.log(billNumber, "search status:", searchRes.status, "search content-type:", searchRes.headers.get("content-type"));
  if (!searchRes.ok) return;

  const searchHtml = await searchRes.text();
  const docUrl = findHtmlDocumentUrl(searchHtml, billNumber);
  console.log(billNumber, "docUrl:", docUrl);
  if (!docUrl) return;

  const docRes = await fetch(docUrl, { headers: { Accept: "text/html, text/plain, */*" } });
  console.log(billNumber, "doc status:", docRes.status);
  console.log(billNumber, "doc content-type:", JSON.stringify(docRes.headers.get("content-type")));
  console.log(billNumber, "ALL doc headers:");
  for (const [k, v] of docRes.headers.entries()) console.log("   ", k + ":", v);
}

await check("1433", "2025-26");
console.log("=".repeat(80));
await check("5890", "2025-26");
