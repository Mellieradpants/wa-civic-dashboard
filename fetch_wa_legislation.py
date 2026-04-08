from pathlib import Path
import requests

BASE_URL = "https://wslwebservices.leg.wa.gov/legislationservice.asmx/GetLegislationByYear"

def fetch_legislation():
    response = requests.get(
        BASE_URL,
        params={"year": 2025},
        timeout=30,
    )
    response.raise_for_status()
    return response.text

if __name__ == "__main__":
    xml = fetch_legislation()
    Path("live-wa-response.xml").write_text(xml, encoding="utf-8")
    print("Wrote live-wa-response.xml")
