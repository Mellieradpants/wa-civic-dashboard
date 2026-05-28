export async function getNormalizedBill(biennium, billNumber) {
  console.log("inside adapter", biennium, billNumber);

  const normalizedBillId = normalizeBillIdFromInput(billNumber);
  const localCandidates = buildLocalCandidates(normalizedBillId);

  for (const path of localCandidates) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;

      const data = await res.json();
      const normalized = normalizeLocalBill(data, {
        biennium,
        requestedBillNumber: billNumber,
        sourcePath: path
      });

      console.log("adapter loaded local normalized bill from", path);
      return normalized;
    } catch (error) {
      console.warn("adapter local candidate failed", path, error);
    }
  }

  console.log("adapter falling back to live WA Legislature API for", billNumber);
  return fetchFromLiveApi(biennium, normalizedBillId);
}

async function fetchFromLiveApi(biennium, normalizedBillId) {
  const numericBillNumber = extractBillNumber(normalizedBillId) || normalizedBillId;
  const resolvedBiennium = normalizeBiennium(biennium);

  const apiUrl = `/api/wa-bill-detail?${new URLSearchParams({
    billNumber: numericBillNumber,
    biennium: resolvedBiennium,
  }).toString()}`;

  const res = await fetch(apiUrl, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `WA bill detail API failed for ${normalizedBillId}: HTTP ${res.status} — ${data.message || "unknown error"}`
    );
  }

  if (!data.title) {
    throw new Error(
      `No bill data returned for ${normalizedBillId} (biennium ${resolvedBiennium})`
    );
  }

  return normalizeLiveApiBill(data, {
    biennium: resolvedBiennium,
    normalizedBillId,
    numericBillNumber,
  });
}

function normalizeLiveApiBill(data, context) {
  const { biennium, normalizedBillId, numericBillNumber } = context;

  const billIdFromApi = data.currentStatus?.billId || normalizedBillId;
  const billId = normalizeBillIdFromInput(billIdFromApi) || normalizedBillId;

  return {
    schemaVersion: "wa.bill.v1",
    jurisdiction: "wa",
    sourceSystem: "wa_legislature_api",
    sourceType: "bill",
    sourceUrl: data.source_url || null,
    retrievedAt: new Date().toISOString(),

    billId,
    biennium,
    billNumber: numericBillNumber,
    billPrefix: extractBillPrefix(billId),

    title: data.title || "Untitled bill",
    longTitle: data.legalTitle || data.summary || null,
    description: data.summary || null,
    status: data.status || null,

    raw: data,
  };
}

function buildLocalCandidates(normalizedBillId) {
  return [
    `./data/wa/bills/${normalizedBillId}.json`,
    `./data/wa/bills/${normalizedBillId.toLowerCase()}.json`,
  ];
}

function normalizeBiennium(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    const startYear = year % 2 === 0 ? year - 1 : year;
    return `${startYear}-${String(startYear + 1).slice(-2)}`;
  }
  const year = new Date().getUTCFullYear();
  const startYear = year % 2 === 0 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function normalizeBillIdFromInput(value) {
  if (!value) return "";
  const cleaned = String(value).trim().toUpperCase().replace(/\s+/g, "");
  const match = cleaned.match(/^([A-Z]+)?(\d+)$/);
  if (!match) return cleaned;
  const prefix = match[1] || "";
  const number = match[2];
  return `${prefix}${number}`;
}

function normalizeLocalBill(data, context) {
  const billId =
    data.bill_id ||
    data.billId ||
    data.bill_id_display ||
    normalizeBillIdFromInput(context.requestedBillNumber);

  const title =
    data.title ||
    data.short_title ||
    data.shortTitle ||
    data.topic ||
    "Untitled bill";

  const longTitle =
    data.long_title ||
    data.longTitle ||
    data.description ||
    data.bill_text ||
    null;

  const description =
    data.description ||
    data.summary ||
    data.about ||
    null;

  const status =
    data.status ||
    data.current_status ||
    data.currentStatus ||
    null;

  return {
    schemaVersion: "wa.bill.v1",
    jurisdiction: "wa",
    sourceSystem: "wa_civic_dashboard_local",
    sourceType: "bill",
    sourceUrl: data.source_url || data.sourceUrl || context.sourcePath,
    retrievedAt: new Date().toISOString(),

    billId,
    biennium: context.biennium,
    billNumber: extractBillNumber(billId),
    billPrefix: extractBillPrefix(billId),

    title,
    longTitle,
    description,
    status,

    raw: data,
  };
}

function extractBillPrefix(billId) {
  if (!billId) return null;
  const match = String(billId).toUpperCase().match(/^([A-Z]+)/);
  return match ? match[1] : null;
}

function extractBillNumber(billId) {
  if (!billId) return null;
  const match = String(billId).match(/(\d+)/);
  return match ? match[1] : null;
}
