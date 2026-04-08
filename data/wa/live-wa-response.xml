from pathlib import Path
from prototype.wa_legislature_adapter import parse_wa_legislature_xml, normalized_text_from_blocks

xml_text = Path("live-wa-response.xml").read_text(encoding="utf-8")
normalized = parse_wa_legislature_xml(xml_text)
text_output = normalized_text_from_blocks(normalized)

Path("live-wa-normalized.txt").write_text(text_output, encoding="utf-8")

print("Wrote live-wa-normalized.txt")
print(text_output)
