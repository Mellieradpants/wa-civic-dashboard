export default function handler(req, res) {
  return res.status(410).json({
    message: "Bill selection is part of the source-anchored analysis.",
    replacement: "/api/wa-bill-text",
    selectionPath: "analysis.documents[].selection",
  });
}
