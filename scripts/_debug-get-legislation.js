const LEGISLATION_SERVICE_BASE = "https://wslwebservices.leg.wa.gov/legislationservice.asmx";
const billNumber = process.argv[2] || "1015";
const biennium = process.argv[3] || "2025-26";

const url = `${LEGISLATION_SERVICE_BASE}/GetLegislation?${new URLSearchParams({ biennium, billNumber })}`;

const response = await fetch(url, { headers: { Accept: "text/xml, application/xml, */*" } });
const xml = await response.text();
console.log(xml);
