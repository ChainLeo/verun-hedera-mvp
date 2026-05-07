const { listValidators } = require('../src/evaluate');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.status(200).json({
    validators: listValidators(),
    total: listValidators().length,
    consensus_required: 2,
    note: 'Pass validatorIds array in POST /api/evaluate to select validators. Min 2 required.',
  });
};
