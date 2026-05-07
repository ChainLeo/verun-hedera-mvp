require('dotenv').config();
const express = require('express');
const path = require('path');
const { evaluateAgent, listValidators } = require('./evaluate');
const { anchorEvaluation } = require('./anchor');

const app = express();
app.use(express.json());

// Static frontend (index.html, docs.html, competitive-landscape.html)
const ROOT = path.join(__dirname, '..');
app.use(express.static(ROOT, { extensions: ['html'] }));

app.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'verun-hedera-mvp', network: `hedera-${process.env.HEDERA_NETWORK || 'testnet'}` })
);

app.get('/validators', (_req, res) =>
  res.json({
    validators: listValidators(),
    total: listValidators().length,
    consensus_required: 2,
    note: 'Pass validatorIds array in POST /evaluate to select validators. Min 2 required.',
  })
);

app.post('/score', async (req, res) => {
  const { agentId = 'agent', score = 0, operation = 'read', validatorIds = null } = req.body || {};
  const out = await evaluateAgent({ agentId, score: Number(score), operation, validatorIds });
  res.json(out);
});

app.post('/evaluate', async (req, res) => {
  try {
    const { agentId = 'agent', score = 0, operation = 'read', validatorIds = null } = req.body || {};
    const verdict = await evaluateAgent({ agentId, score: Number(score), operation, validatorIds });
    let anchor = null;
    try {
      anchor = await anchorEvaluation({
        type: 'verun-evaluation',
        agentId,
        score: Number(score),
        operation,
        consensus: verdict.consensus,
        permitted: verdict.permitted,
        validators: verdict.validators_used.map((v) => v.id),
        ts: verdict.ts,
      });
    } catch (anchorErr) {
      anchor = { error: anchorErr.message, status: 'anchor_failed' };
    }
    res.json({ success: true, verdict, anchor });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 3010;
if (require.main === module) {
  app.listen(PORT, () => console.log(`verun-hedera-mvp API on :${PORT}`));
}

module.exports = app;
