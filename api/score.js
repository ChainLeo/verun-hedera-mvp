const { evaluateAgent } = require('../src/evaluate');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { agentId = 'agent', score = 0, operation = 'read', validatorIds = null } = req.body || {};
  const out = await evaluateAgent({ agentId, score: Number(score), operation, validatorIds });
  res.status(200).json(out);
};
