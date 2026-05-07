const {
  getOperator,
  getAccountBalanceHbar,
  ensureFunded,
  explorerAccount,
  HEDERA_NETWORK,
} = require('../src/hedera');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let address = null;
    try {
      address = getOperator().accountId;
    } catch (e) {
      return res.status(500).json({ ok: false, error: `HEDERA_OPERATOR_ID not configured: ${e.message}` });
    }

    let fundResult = null;
    try {
      fundResult = await ensureFunded(address, 1);
    } catch (e) {
      fundResult = { funded: false, error: e.message };
    }

    let hbar = 0;
    try {
      hbar = await getAccountBalanceHbar(address);
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Balance query failed: ${e.message}` });
    }

    res.status(200).json({
      ok: true,
      network: `hedera-${HEDERA_NETWORK}`,
      address,
      explorer: explorerAccount(address),
      fund_check: fundResult,
      balance: {
        hbar,
        tinybars: Math.round(hbar * 1e8),
        funded: hbar >= 1,
        recommendedMinHbar: 1,
      },
      faucet: 'https://portal.hedera.com',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
