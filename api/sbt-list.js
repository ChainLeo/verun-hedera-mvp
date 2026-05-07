const { listSBT } = require('../src/sbt');

const safeJson = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const out = await listSBT();
    res.status(200).json(safeJson(out));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
