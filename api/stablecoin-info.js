/**
 * GET /api/stablecoin-info
 * ─────────────────────────────────────────────────────────────────────
 * Returns the live HTS metadata for every stablecoin Verun accepts via
 * x402 — using the same Mirror Node query layer that Hedera Stablecoin
 * Studio uses internally.
 *
 * Example response:
 * {
 *   "ok": true,
 *   "stablecoins": [
 *     {
 *       "tokenId": "0.0.429274",
 *       "symbol": "USDC",
 *       "name": "USD Coin",
 *       "decimals": 6,
 *       "type": "FUNGIBLE_COMMON",
 *       "treasury": "0.0.xxx",
 *       "issuer": "Circle",
 *       "studio_compatible": true,
 *       "warnings": []
 *     }
 *   ]
 * }
 */

const {
  knownStablecoins,
  validateStablecoinForX402,
} = require('../src/stablecoin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const list = knownStablecoins();
    const enriched = await Promise.all(
      list.map(async (s) => {
        const v = await validateStablecoinForX402(s.tokenId);
        return {
          ...s,
          name: v.info?.name || null,
          decimals: v.info?.decimals ?? s.decimals,
          type: v.info?.type || null,
          treasury: v.info?.treasury || null,
          totalSupply: v.info?.totalSupply || null,
          studio_compatible: true,
          warnings: v.warnings || [],
          ok: v.ok,
        };
      })
    );

    return res.status(200).json({
      ok: true,
      provider: 'Hedera Mirror Node',
      compatible_with: 'Stablecoin Studio (https://github.com/hashgraph/stablecoin-studio)',
      stablecoins: enriched,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
    });
  }
};
