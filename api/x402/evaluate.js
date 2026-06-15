/**
 * POST /api/x402/evaluate — x402-paid Verun Trust Evaluation on Hedera
 * ──────────────────────────────────────────────────────────────────────
 * Hedera-native agentic-commerce endpoint:
 *   pay 0.005 USDC (or 0.005 HBAR) → get consensus trust verdict → anchored on HCS.
 *
 * Without X-PAYMENT header → returns HTTP 402 + paymentRequirements (USDC + HBAR)
 * With    X-PAYMENT header → verifies + settles via Hedera Official Facilitator
 *                              + runs Verun 2-of-3 validator consensus
 *                              + anchors verdict on HCS topic
 *                              + returns { verdict, anchor, settlement }
 */

const { evaluateAgent } = require('../../src/evaluate');
const { anchorEvaluation } = require('../../src/anchor');
const {
  buildPaymentRequirements,
  facilitatorVerify,
  facilitatorSettle,
  FACILITATOR_URL,
  PRICE_USDC,
  PRICE_HBAR,
  NETWORK_KIND,
  SIMULATE,
} = require('../../src/x402');

const safeJson = (o) =>
  JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT, x-payment');
  res.setHeader('Access-Control-Expose-Headers', 'X-402-Powered, X-PAYMENT-RESPONSE');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Build paymentRequirements for this resource
  let paymentRequirements;
  try {
    paymentRequirements = buildPaymentRequirements({
      resource: '/api/x402/evaluate',
      description:
        `Verun Trust Evaluation · ${PRICE_USDC} USDC or ${PRICE_HBAR} HBAR · ` +
        `2-of-3 validator consensus + HCS audit anchor on Hedera ${NETWORK_KIND}.`,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'config_error',
      detail: e.message,
      hint: 'Set HEDERA_OPERATOR_ID (or HEDERA_PAY_TO) in your environment.',
    });
  }

  // ── Read X-PAYMENT header (case-insensitive, base64 JSON) ──────────
  const xPaymentHeader = req.headers['x-payment'] || req.headers['X-PAYMENT'];

  // ── No X-PAYMENT → HTTP 402 challenge ───────────────────────────────
  if (!xPaymentHeader) {
    res.setHeader('X-402-Powered', `${FACILITATOR_URL} - USDC + HBAR`);
    // Mirror HEAD = GET headers without body (RFC 7231)
    if (req.method === 'HEAD') return res.status(402).end();
    return res.status(402).json(paymentRequirements);
  }

  // ── With X-PAYMENT → verify + settle + evaluate + anchor ────────────
  try {
    // Step 1: verify payment via facilitator
    const verifyResult = await facilitatorVerify({ xPaymentHeader, paymentRequirements });
    if (!verifyResult.ok && !verifyResult.simulated) {
      return res.status(402).json({
        error: 'payment_verify_failed',
        facilitatorResponse: verifyResult,
      });
    }

    // Step 2: settle on-chain via facilitator
    const settleResult = await facilitatorSettle({ xPaymentHeader, paymentRequirements });
    if (!settleResult.ok && !settleResult.simulated) {
      return res.status(402).json({
        error: 'payment_settle_failed',
        facilitatorResponse: settleResult,
      });
    }

    // Step 3: parse evaluation payload from body (or default demo values)
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch {
      body = {};
    }
    const {
      agentId = 'agt_demo',
      score = 820,
      operation = 'transfer',
      validatorIds = ['val-erster-01', 'val-tokenforge-02', 'val-test-03'],
    } = body;

    // Step 4: run Verun 2-of-3 validator consensus
    const verdict = await evaluateAgent({
      agentId,
      score: Number(score),
      operation,
      validatorIds,
    });

    // Step 5: anchor verdict to HCS
    let anchor;
    try {
      anchor = await anchorEvaluation({
        type: 'verun-evaluation-x402',
        agentId,
        score: Number(score),
        operation,
        consensus: verdict.consensus,
        permitted: verdict.permitted,
        validators: verdict.validators_used.map((v) => v.id),
        settlement_txid: settleResult.txid || null,
        ts: verdict.ts,
      });
    } catch (e) {
      anchor = { error: e.message, status: 'anchor_failed' };
    }

    return res.status(200).json(
      safeJson({
        success: true,
        verdict,
        anchor,
        settlement: {
          ok: !!settleResult.ok,
          simulated: !!settleResult.simulated,
          txid: settleResult.txid || null,
          explorer: settleResult.explorer || null,
          facilitator: FACILITATOR_URL,
          note: SIMULATE
            ? 'Hedera Official x402 Facilitator URL not yet set — settlement simulated. Set X402_FACILITATOR_URL when Hedera publishes the live endpoint.'
            : undefined,
        },
      })
    );
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message || String(e),
    });
  }
};
