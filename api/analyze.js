export default async function handler(req, res) {
  return res.status(410).json({
    message: "This endpoint has been replaced by /api/plain-meaning.",
    replacement: "/api/plain-meaning",
  });
}
