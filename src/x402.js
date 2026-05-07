/**
 * Verun · x402 Payment Layer (Hedera, "exact" scheme)
 * ──────────────────────────────────────────────────────────────────────────
 * Implements the x402 spec for Hedera using two payment schemes accepted
 * side-by-side via the Hedera Official x402 Facilitator:
 *
 *   1. USDC (HTS fungible token) — Circle's USDC on Hedera
 *   2. HBAR (native gas token)   — Hedera's native asset
 *
 * Flow:
 *   1. Client GET  /api/x402/evaluate              → 402 + paymentRequirements
 *   2. Client signs a Hedera TransferTransaction
 *      (USDC TokenTransfer or native HBAR transfer to protocol payTo)
 *   3. Client POST /api/x402/evaluate + X-PAYMENT header (base64 signed txn)
 *   4. Server forwards X-PAYMENT to facilitator /verify
 *   5. On success → facilitator /settle (submits on-chain)
 *   6. Server runs Verun 2-of-3 validator consensus
 *   7. Server anchors verdict to HCS topic (audit trail)
 *   8. Returns 200 + { verdict, anchor, settlement }
 *
 * Honest scope note:
 *   - Schemes returned in 402 are spec-compliant.
 *   - facilitator /verify + /settle endpoints are wired and configurable
 *     via X402_FACILITATOR_URL (default: Hedera Official Facilitator).
 *   - Real on-chain settlement requires the facilitator URL to be live;
 *     until then `simulate` mode returns synthesized success for the demo.
 */

// ── CAIP-2 network IDs (Hedera) ─────────────────────────────
// Per CAIP-2 registry: hedera:mainnet, hedera:testnet, hedera:previewnet
const HEDERA_MAINNET_CAIP2 = 'hedera:mainnet';
const HEDERA_TESTNET_CAIP2 = 'hedera:testnet';

// ── USDC on Hedera (HTS token) ───────────────────────────────
// Circle USDC on Hedera token IDs (HTS format: 0.0.X)
const USDC_TESTNET_TOKEN_ID = '0.0.429274';
const USDC_MAINNET_TOKEN_ID = '0.0.456858';
const USDC_DECIMALS = 6;

// ── HBAR (native) ────────────────────────────────────────────
// HBAR uses 8 decimals at the protocol level (tinybar = 10^-8 HBAR)
const HBAR_DECIMALS = 8;

// ── Hedera Official x402 Facilitator ─────────────────────────
// Placeholder URL — replace once Hedera publishes the official endpoint.
// Override via env: X402_FACILITATOR_URL=https://...
const HEDERA_X402_FACILITATOR_DEFAULT = 'https://x402.hedera.com';

// ── Resolved config (env-overridable) ────────────────────────
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || HEDERA_X402_FACILITATOR_DEFAULT;
const PRICE_USDC      = Number(process.env.X402_PRICE_USDC || '0.01'); // $0.01
const PRICE_HBAR      = Number(process.env.X402_PRICE_HBAR || '0.01'); // 0.01 HBAR
const NETWORK_KIND    = (process.env.X402_NETWORK || 'testnet').toLowerCase();
const NETWORK_CAIP2   = NETWORK_KIND === 'mainnet' ? HEDERA_MAINNET_CAIP2 : HEDERA_TESTNET_CAIP2;
const USDC_TOKEN_ID   = NETWORK_KIND === 'mainnet' ? USDC_MAINNET_TOKEN_ID : USDC_TESTNET_TOKEN_ID;

// Simulate facilitator if URL is the placeholder (so the live terminal demo
// still produces a clean transcript even before Hedera publishes the real one).
const SIMULATE = !process.env.X402_FACILITATOR_URL && FACILITATOR_URL === HEDERA_X402_FACILITATOR_DEFAULT;

function getPayToAddress() {
  // Hedera operator account doubles as the protocol payTo address by default.
  return (
    process.env.HEDERA_PAY_TO ||
    process.env.HEDERA_OPERATOR_ID ||
    null
  );
}

/**
 * Build x402 paymentRequirements payload (returned with HTTP 402).
 * Spec: https://docs.x402.org
 */
function buildPaymentRequirements({
  resource,
  description,
  amountUSDC = PRICE_USDC,
  amountHBAR = PRICE_HBAR,
} = {}) {
  const payTo = getPayToAddress();
  if (!payTo) throw new Error('HEDERA_OPERATOR_ID / HEDERA_PAY_TO not configured');

  // Convert decimal amounts → smallest unit per asset.
  // USDC: 6 decimals → 0.01 USDC = 10,000 micro-USDC
  // HBAR: 8 decimals → 0.01 HBAR = 1,000,000 tinybars
  const microUSDC = Math.round(amountUSDC * Math.pow(10, USDC_DECIMALS)).toString();
  const tinybars  = Math.round(amountHBAR * Math.pow(10, HBAR_DECIMALS)).toString();

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK_CAIP2,
        asset: USDC_TOKEN_ID,
        payTo,
        maxAmountRequired: microUSDC,
        maxTimeoutSeconds: 300,
        resource: resource || '/api/x402/evaluate',
        description: description || `Verun Trust Evaluation · ${amountUSDC} USDC · Hedera`,
        mimeType: 'application/json',
        extra: {
          name: 'USDC',
          decimals: USDC_DECIMALS,
          tokenStandard: 'HTS',
          network: NETWORK_KIND,
          facilitator: FACILITATOR_URL,
          provider: 'Hedera Official Facilitator',
        },
      },
      {
        scheme: 'exact',
        network: NETWORK_CAIP2,
        asset: 'HBAR',
        payTo,
        maxAmountRequired: tinybars,
        maxTimeoutSeconds: 300,
        resource: resource || '/api/x402/evaluate',
        description: description || `Verun Trust Evaluation · ${amountHBAR} HBAR · Hedera`,
        mimeType: 'application/json',
        extra: {
          name: 'HBAR',
          decimals: HBAR_DECIMALS,
          tokenStandard: 'native',
          network: NETWORK_KIND,
          facilitator: FACILITATOR_URL,
          provider: 'Hedera Official Facilitator',
        },
      },
    ],
  };
}

/**
 * Decode the X-PAYMENT header — base64-encoded JSON with the signed
 * Hedera TransferTransaction bytes + scheme metadata.
 */
function decodePaymentHeader(xPaymentHeader) {
  if (!xPaymentHeader) return null;
  try {
    const decoded = Buffer.from(xPaymentHeader, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (e) {
    return { error: 'invalid_x_payment_encoding', detail: e.message };
  }
}

/**
 * POST {facilitator}/verify — verify the signed payment without submitting.
 */
async function facilitatorVerify({ xPaymentHeader, paymentRequirements }) {
  if (SIMULATE) {
    return {
      simulated: true,
      ok: true,
      reason: 'facilitator_url_not_set — simulated verify pass',
    };
  }
  const r = await fetch(`${FACILITATOR_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 1,
      paymentPayload: xPaymentHeader,
      paymentRequirements,
    }),
  });
  const body = await r.json().catch(() => ({ raw: r.statusText }));
  return { httpStatus: r.status, ...body };
}

/**
 * POST {facilitator}/settle — submit the verified payment to Hedera.
 */
async function facilitatorSettle({ xPaymentHeader, paymentRequirements }) {
  if (SIMULATE) {
    // Generate a plausible-looking testnet txid for the simulated path so the
    // demo terminal renders something realistic.
    const op = (process.env.HEDERA_OPERATOR_ID || '0.0.0').trim();
    const ts = Math.floor(Date.now() / 1000);
    const ns = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const fakeTxid = `${op}@${ts}.${ns}`;
    return {
      simulated: true,
      ok: true,
      txid: fakeTxid,
      explorer: `https://hashscan.io/testnet/tx/${encodeURIComponent(fakeTxid)}`,
      reason: 'facilitator_url_not_set — simulated settlement (replace X402_FACILITATOR_URL with real Hedera facilitator)',
    };
  }
  const r = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 1,
      paymentPayload: xPaymentHeader,
      paymentRequirements,
    }),
  });
  const body = await r.json().catch(() => ({ raw: r.statusText }));
  return { httpStatus: r.status, ...body };
}

module.exports = {
  // Constants
  HEDERA_MAINNET_CAIP2,
  HEDERA_TESTNET_CAIP2,
  USDC_TESTNET_TOKEN_ID,
  USDC_MAINNET_TOKEN_ID,
  USDC_DECIMALS,
  HBAR_DECIMALS,
  HEDERA_X402_FACILITATOR_DEFAULT,
  FACILITATOR_URL,
  PRICE_USDC,
  PRICE_HBAR,
  NETWORK_CAIP2,
  USDC_TOKEN_ID,
  NETWORK_KIND,
  SIMULATE,

  // Helpers
  getPayToAddress,
  buildPaymentRequirements,
  decodePaymentHeader,
  facilitatorVerify,
  facilitatorSettle,
};
