from pathlib import Path
import json
from prototype.wa_legislature_adapter import (
    parse_wa_legislature_xml,
    normalized_text_from_blocks,
)

xml_path = Path("data/wa/live-wa-response.xml")
output_path = Path("data/wa/live-wa-normalized.json")

xml_text = xml_path.read_text(encoding="utf-8")

normalized = parse_wa_legislature_xml(xml_text)
text_output = normalized_text_from_blocks(normalized)

payload = {
    "inputSource": str(xml_path),
    "normalized": normalized,
    "textOutput": text_output,
}

output_path.parent.mkdir(parents=True, exist_ok=True)

output_path.write_text(
    json.dumps(payload, indent=2, ensure_ascii=False),
    encoding="utf-8",
)

print(f"Wrote {output_path}")
   
