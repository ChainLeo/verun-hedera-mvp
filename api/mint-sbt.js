const { mintSBT } = require('../src/sbt');
const { evaluateAgent } = require('../src/evaluate');

const safeJson = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { agentId, score, operation = 'transfer' } = req.body || {};
    if (!agentId) return res.status(400).json({ success: false, error: 'agentId required' });
    if (score === undefined) return res.status(400).json({ success: false, error: 'score required' });

    // Run consensus first — only credential agents that pass operation gate.
    const verdict = await evaluateAgent({
      agentId,
      score: Number(score),
      operation,
    });

    if (!verdict.permitted) {
      return res.status(403).json({
        success: false,
        error: 'consensus_block',
        verdict,
        message: `Agent ${agentId} did not pass ${operation} gate (consensus=${verdict.consensus}). SBT not issued.`,
      });
    }

    const out = await mintSBT({ agentId, score: Number(score) });
    res.status(200).json(safeJson({ success: true, verdict_consensus: verdict.consensus, ...out }));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
};
