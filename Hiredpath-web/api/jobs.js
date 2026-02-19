// api/jobs.js
// Minimal cloud API for demo/testing.
// GET  /api/jobs?userId=xxx
// POST /api/jobs  { userId, items }

let STORE = {}; // in-memory

export default async function handler(req, res) {
  const { method } = req;

  if (method === "GET") {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const items = STORE[userId] || [];
    return res.status(200).json(items);
  }

  if (method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { userId, items } = body || {};
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      if (!Array.isArray(items)) return res.status(400).json({ error: "items must be an array" });

      STORE[userId] = items;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
