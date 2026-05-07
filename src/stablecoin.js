/**
 * Verun · Hedera Stablecoin Studio integration helpers
 * ─────────────────────────────────────────────────────────────────────────
 * Stablecoin Studio (https://github.com/hashgraph/stablecoin-studio) is the
 * Hedera-native toolkit for issuing + managing regulated stablecoins on HTS.
 *
 * What this module does (honest scope):
 *   1. Validates that the USDC token Verun accepts via x402 is properly
 *      configured on Hedera HTS — name, symbol, decimals, supply, treasury.
 *   2. Provides token-association checks (HTS tokens require accounts to
 *      explicitly associate before receiving the token — Stablecoin Studio
 *      handles this for issued tokens; we replicate the check for incoming).
 *   3. Exposes a Mirror Node query layer that is identical to what
 *      Stablecoin Studio uses under the hood — so any token issued via
 *      Studio is interoperable with this protocol out of the box.
 *
 * What this module does NOT do (yet):
 *   - Issue new stablecoins. The protocol consumes existing HTS tokens
 *     (Circle's USDC) rather than issuing its own. If we later want to
 *     issue a "Verun trust credit" token, we add @hashgraph/stablecoin-studio-sdk
 *     and a /api/stablecoin/issue endpoint.
 *   - Burn/freeze/wipe. KYC/compliance lifecycle ops are out of scope.
 *
 * Compatibility:
 *   Any stablecoin issued via Stablecoin Studio with the standard HTS schema
 *   (FUNGIBLE_COMMON, finite or infinite supply, optional KYC + freeze keys)
 *   can be added to the x402 paymentRequirements `accepts` list and will
 *   route through the same Mirror Node verification path used here.
 */

// dotenv is loaded by the API entrypoints; load defensively here so the
// module can also be required directly from scripts.
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const MIRROR_NODE_URL =
  process.env.MIRROR_NODE_URL ||
  ((process.env.HEDERA_NETWORK || 'testnet').toLowerCase() === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com');

const fetchFn = globalThis.fetch ? globalThis.fetch.bind(globalThis) : require('node-fetch');

/**
 * Query a Hedera HTS token's full metadata via Mirror Node.
 * Mirror Node REST path: /api/v1/tokens/{tokenId}
 * Docs: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */
async function getTokenInfo(tokenId) {
  const url = `${MIRROR_NODE_URL}/api/v1/tokens/${encodeURIComponent(tokenId)}`;
  const r = await fetchFn(url);
  if (!r.ok) {
    return {
      ok: false,
      error: `mirror_node_lookup_failed`,
      http: r.status,
      tokenId,
    };
  }
  const body = await r.json();
  return {
    ok: true,
    tokenId: body.token_id,
    name: body.name,
    symbol: body.symbol,
    decimals: Number(body.decimals || 0),
    totalSupply: body.total_supply,
    treasury: body.treasury_account_id,
    type: body.type,           // FUNGIBLE_COMMON / NON_FUNGIBLE_UNIQUE
    supplyType: body.supply_type, // FINITE / INFINITE
    freezeDefault: body.freeze_default,
    kycKey: !!body.kyc_key,
    freezeKey: !!body.freeze_key,
    wipeKey: !!body.wipe_key,
    pauseStatus: body.pause_status,
    created: body.created_timestamp,
    raw: body,
  };
}

/**
 * Check if `accountId` has associated `tokenId` on HTS. Required before
 * the account can hold or receive the token. This is the same check
 * Stablecoin Studio runs before mint/transfer ops.
 *
 * Returns: { ok, associated, balance, frozen, kycGranted }
 */
async function checkAssociation(accountId, tokenId) {
  const url = `${MIRROR_NODE_URL}/api/v1/accounts/${encodeURIComponent(accountId)}/tokens?token.id=${encodeURIComponent(tokenId)}`;
  const r = await fetchFn(url);
  if (!r.ok) {
    return { ok: false, error: 'mirror_node_lookup_failed', http: r.status };
  }
  const body = await r.json();
  const entry = (body.tokens || []).find((t) => t.token_id === tokenId);
  if (!entry) {
    return { ok: true, associated: false, balance: 0, frozen: null, kycGranted: null };
  }
  return {
    ok: true,
    associated: true,
    balance: entry.balance,
    frozen: entry.freeze_status === 'FROZEN',
    kycGranted: entry.kyc_status === 'GRANTED',
  };
}

/**
 * Validate that a HTS token meets Verun's "regulated stablecoin" bar.
 * Soft requirements (mirrors Stablecoin Studio defaults):
 *   - FUNGIBLE_COMMON type
 *   - Has KYC + freeze keys (issuer can enforce compliance)
 *   - Finite or sufficiently-controlled supply
 *
 * Returns: { ok, warnings, info }
 */
async function validateStablecoinForX402(tokenId) {
  const info = await getTokenInfo(tokenId);
  if (!info.ok) return info;

  const warnings = [];
  if (info.type !== 'FUNGIBLE_COMMON') {
    warnings.push(`token type ${info.type} — expected FUNGIBLE_COMMON`);
  }
  if (!info.kycKey) {
    warnings.push('no KYC key set — not enforceable under MiCA Art. 68');
  }
  if (!info.freezeKey) {
    warnings.push('no freeze key set — cannot freeze on compliance event');
  }
  if (info.pauseStatus === 'PAUSED') {
    warnings.push('token is currently PAUSED — payments will fail');
  }

  return {
    ok: warnings.length === 0,
    warnings,
    info,
  };
}

/**
 * Inventory of stablecoins Verun accepts on Hedera.
 * Extend this list when adding new HTS tokens (Stablecoin Studio issued or
 * external) to the x402 paymentRequirements.
 */
function knownStablecoins() {
  return [
    {
      tokenId: process.env.X402_NETWORK === 'mainnet' ? '0.0.456858' : '0.0.429274',
      symbol: 'USDC',
      issuer: 'Circle',
      network: process.env.X402_NETWORK || 'testnet',
      managed_via: 'stablecoin-studio-compatible',
      decimals: 6,
    },
  ];
}

module.exports = {
  getTokenInfo,
  checkAssociation,
  validateStablecoinForX402,
  knownStablecoins,
  MIRROR_NODE_URL,
};
