from pathlib import Path
import json
from prototype.wa_legislature_adapter import (
    parse_wa_legislature_xml,
    normalized_text_from_blocks,
)

# INPUT
xml_path = Path("data/wa/live-wa-response.xml")

# OUTPUT
output_path = Path("data/wa/live-wa-normalized.json")

# READ INPUT
xml_text = xml_path.read_text(encoding="utf-8")

# ADAPTER
normalized = parse_wa_legislature_xml(xml_text)
text_output = normalized_text_from_blocks(normalized)

# PACKAGE OUTPUT
payload = {
    "inputSource": str(xml_path),
    "normalized": normalized,
    "textOutput": text_output,
}

# WRITE OUTPUT
output_path.write_text(
    json.dumps(payload, indent=2, ensure_ascii=False),
    encoding="utf-8",
)

print(f"Wrote {output_path}")
print(text_output)
