/**
 * On-chain anchor for a Verun verdict — Hedera Testnet.
 *
 * Strategy (two TXs for both visibility + canonical audit):
 *   1. HBAR self-transfer (default 0.005 HBAR) with the verdict memo —
 *      visible on HashScan as the demo evaluation price.
 *   2. HCS submitMessage to the configured topic with `verun-eval:` prefix —
 *      canonical, ordered audit channel queryable via Mirror Node REST.
 *
 * The TX returned as `txid`/`explorer` is the HBAR transfer (so the explorer
 * link visibly reflects the 0.005 price). The HCS message is returned in
 * `message_explorer` for audit-trail consumers.
 *
 * Override the transfer amount via the `amount` option or `X402_PRICE_HBAR` env.
 */
require('dotenv').config();
const crypto = require('crypto');
const {
  TransferTransaction,
  Hbar,
  HbarUnit,
  TransactionId,
} = require('@hashgraph/sdk');
const {
  getClient,
  getOperator,
  getTopicId,
  submitTopicMessage,
  explorerTx,
  explorerMessage,
  explorerTopic,
  HEDERA_NETWORK,
} = require('./hedera');

const ANCHOR_PREFIX = 'verun-eval';
// Default anchor amount fetched lazily from market oracle if not env-overridden
const { convertUSDtoNative } = require('./priceOracle');
const PRICE_USD = Number(process.env.X402_PRICE_USD || '0.005');
const PRICE_HBAR_FIXED = process.env.X402_PRICE_HBAR ? Number(process.env.X402_PRICE_HBAR) : null;

async function resolveAnchorAmount(opts) {
  if (opts.amount != null) return String(opts.amount);
  if (PRICE_HBAR_FIXED != null && Number.isFinite(PRICE_HBAR_FIXED)) return String(PRICE_HBAR_FIXED);
  const hbar = await convertUSDtoNative(PRICE_USD, 'HBAR');
  // Round to 8 decimals (HBAR precision) to avoid SDK rejection
  return hbar.toFixed(8).replace(/\.?0+$/, '');
}

async function anchorEvaluation(payload, opts = {}) {
  const { accountId } = getOperator();
  const topicId = getTopicId();

  const json = JSON.stringify(payload);
  const digest = crypto.createHash('sha256').update(json).digest();
  const hashHex = digest.toString('hex');

  const consensus = String(payload.consensus || 'NA');
  const agentId = String(payload.agentId || 'agent').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  const ts = String(payload.ts || new Date().toISOString());

  const memoShort = `${ANCHOR_PREFIX}:${consensus}:${agentId.slice(0, 24)}:${hashHex.slice(0, 16)}`;
  const messageText = `${ANCHOR_PREFIX}:${consensus}:${agentId}:${ts}:${hashHex.slice(0, 16)}`;

  // ── Step 1: HBAR transfer (visible amount on HashScan) ─────────────────
  // If HEDERA_ANCHOR_RECIPIENT is set, transfer goes there (visible).
  // Otherwise it's a self-transfer (sender = receiver = invisible on HashScan UI
  // since Hedera collapses net-zero transfers in the display).
  const amount = await resolveAnchorAmount(opts);
  const hbarAmount = Hbar.fromString(`${amount} ℏ`); // parse human HBAR string
  const recipient = (process.env.HEDERA_ANCHOR_RECIPIENT || '').trim() || accountId;

  const client = getClient();
  let transferResult;
  try {
    const tx = await new TransferTransaction()
      .addHbarTransfer(accountId, hbarAmount.negated())
      .addHbarTransfer(recipient, hbarAmount)
      .setTransactionMemo(memoShort.slice(0, 100)) // Hedera memo max 100 bytes
      .execute(client);
    const receipt = await tx.getReceipt(client);
    transferResult = {
      transactionId: tx.transactionId.toString(),
      status: receipt.status.toString(),
      explorer: explorerTx(tx.transactionId.toString()),
    };
  } finally {
    client.close();
  }

  // ── Step 2: HCS topic submit (canonical audit channel) ────────────────
  let hcsResult = null;
  try {
    hcsResult = await submitTopicMessage(messageText);
  } catch (e) {
    // HCS submit failure shouldn't fail the whole anchor — transfer already done
    hcsResult = { error: e.message, status: 'hcs_submit_failed' };
  }

  return {
    txid: transferResult.transactionId,
    ledger: hcsResult?.sequenceNumber || '',
    sequence_number: hcsResult?.sequenceNumber || null,
    topic_id: topicId,
    network: `hedera-${HEDERA_NETWORK}`,
    payer: accountId,
    recipient,
    amount,
    asset: 'HBAR',
    memo_hash: hashHex,
    payload_hash: hashHex,
    payload_size: json.length,
    explorer: transferResult.explorer,
    topic_explorer: explorerTopic(topicId),
    message_explorer: hcsResult?.sequenceNumber ? explorerMessage(topicId, hcsResult.sequenceNumber) : null,
    message: messageText,
  };
}

module.exports = { anchorEvaluation };
