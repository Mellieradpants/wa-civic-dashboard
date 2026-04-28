const BILL_TEXT_ENDPOINT = "/api/wa-bill-text";

function extractBillNumber(text) {
  const match = String(text || "").match(/\b\d{3,4}\b/);
  return match ? match[0] : "";
}

function normalizeBiennium(value) {
  const text = String(value || "").trim();

  if (/^\d{4}-\d{2}$/.test(text)) return text;

  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    const startYear = year % 2 === 0 ? year - 1 : year;
    return `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const startYear = year % 2 === 0 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${proto}://${host}`;
}

async function loadBillText(req, billNumber, biennium) {
  const baseUrl = getBaseUrl(req);
  const url = `${baseUrl}${BILL_TEXT_ENDPOINT}?${new URLSearchParams({ billNumber, biennium }).toString()}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Bill text lookup failed with HTTP ${response.status}`);
  }

  return response.json();
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
}

function classifySentence(sentence) {
  const text = String(sentence || "");
  const lower = text.toLowerCase();
  const classifications = [];

  if (/\b(may not|must not|shall not|prohibited from|is prohibited)\b/i.test(text)) {
    classifications.push("prohibition");
  }

  if (/\b(must|shall|required to|is required to|are required to)\b/i.test(text)) {
    classifications.push("obligation");
  }

  if (/\bmay\b/i.test(text) && !/\bmay not\b/i.test(text)) {
    classifications.push("permission");
  }

  if (/\b(if|unless|when|only if|provided that|subject to)\b/i.test(text)) {
    classifications.push("condition");
  }

  if (/\b(except|exception|does not apply|notwithstanding)\b/i.test(text)) {
    classifications.push("exception");
  }

  if (/\b(means|is defined as|are defined as|definition)\b/i.test(text)) {
    classifications.push("definition");
  }

  if (/\b(RCW|executive order|federal law|court order|agency|department|Nlets|ACCESS|DAPS)\b/i.test(text)) {
    classifications.push("reference");
  }

  return [...new Set(classifications)];
}

function choosePrimaryType(types) {
  const priority = ["prohibition", "obligation", "permission", "definition", "condition", "exception", "reference"];
  return priority.find((type) => types.includes(type)) || "context";
}

function extractReferences(sentence) {
  const refs = [];
  const patterns = [
    { type: "rcw", regex: /\bRCW\s+[0-9A-Za-z.]+(?:\s+[0-9A-Za-z.()]+)?/gi },
    { type: "executive_order", regex: /\b(?:governor'?s\s+)?executive order\b[^.;]*/gi },
    { type: "federal_law", regex: /\bfederal law\b[^.;]*/gi },
    { type: "court_order", regex: /\bcourt order\b[^.;]*/gi },
    { type: "system", regex: /\b(?:Nlets|ACCESS|DAPS)\b/gi },
  ];

  patterns.forEach(({ type, regex }) => {
    let match;
    while ((match = regex.exec(sentence)) !== null) {
      const value = match[0].trim();
      if (value.length) {
        refs.push({ type, text: value });
      }
    }
  });

  return refs;
}

function selectMeaningUnitsFromSection(section) {
  const sentences = splitSentences(section.text);
  const units = [];

  sentences.forEach((sentence, index) => {
    const types = classifySentence(sentence);

    if (!types.length) return;

    const primaryType = choosePrimaryType(types);
    const references = extractReferences(sentence);

    units.push({
      id: `${section.id || "section"}_unit_${index + 1}`,
      sectionId: section.id,
      sectionNumber: section.sectionNumber,
      primaryType,
      signalTypes: types,
      sourceSpan: sentence,
      references,
      selectionReason: "Sentence contains one or more structure signals relevant to rule, condition, exception, definition, or reference selection.",
      status: "selected_candidate",
    });
  });

  return units;
}

function summarizeSelection(units) {
  const counts = units.reduce((acc, unit) => {
    acc[unit.primaryType] = (acc[unit.primaryType] || 0) + 1;
    return acc;
  }, {});

  return {
    selectedCandidateCount: units.length,
    countsByPrimaryType: counts,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  const rawBill = req.query.billNumber || req.query.bill || req.query.q || "";
  const billNumber = extractBillNumber(rawBill);
  const biennium = normalizeBiennium(req.query.biennium || req.query.session || req.query.year);

  if (!billNumber) {
    return res.status(400).json({
      message: "Missing bill number.",
      expectedQuery: "/api/wa-bill-selection?billNumber=6361&biennium=2025-26",
    });
  }

  try {
    const textData = await loadBillText(req, billNumber, biennium);
    const sections = textData.sections || [];
    const selectedUnits = sections.flatMap(selectMeaningUnitsFromSection);

    return res.status(200).json({
      sourceSystem: "Washington Civic Dashboard selection layer",
      billNumber,
      biennium,
      sourceDocument: textData.sourceDocument,
      sectionCount: sections.length,
      selectionSummary: summarizeSelection(selectedUnits),
      selectedUnits,
      note: "Selection v1 identifies candidate meaning-bearing units from source sections. It does not generate plain meaning, merge rules, or interpret legal effect.",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Washington bill selection failed.",
      billNumber,
      biennium,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
