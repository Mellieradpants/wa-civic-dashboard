import xml.etree.ElementTree as ET


def parse_wa_legislature_xml(xml_text):
    root = ET.fromstring(xml_text)

    blocks = []

    # very simple extraction: grab all text nodes
    for elem in root.iter():
        text = (elem.text or "").strip()
        if text:
            blocks.append({
                "tag": elem.tag,
                "text": text
            })

    return {
        "source": "wa_legislature_xml",
        "blocks": blocks
    }


def normalized_text_from_blocks(normalized):
    blocks = normalized.get("blocks", [])
    return "\n\n".join(b["text"] for b in blocks if b.get("text"))
