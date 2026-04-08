
export async function getNormalizedBill(biennium, billNumber) {
  const url = `https://wslwebservices.leg.wa.gov/legislationservice.asmx/GetLegislation?biennium=${biennium}&billNumber=${billNumber}`

  const res = await fetch(url)
  const xmlText = await res.text()

  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlText, "text/xml")

  const get = (tag) => {
    const el = xmlDoc.getElementsByTagName(tag)[0]
    return el ? el.textContent.trim() : null
  }

  return {
    billId: get("BillId"),
    billNumber: get("BillNumber"),
    title: get("ShortDescription"),
    longTitle: get("LegalTitle"),
    description: get("LongDescription"),
    status: get("CurrentStatus")
  }
}
