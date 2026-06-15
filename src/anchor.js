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
const DEFAULT_ANCHOR_AMOUNT = process.env.X402_PRICE_HBAR || '0.005';

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

  // ── Step 1: HBAR self-transfer (visible amount on HashScan) ───────────
  const amount = String(opts.amount || DEFAULT_ANCHOR_AMOUNT);
  const hbarAmount = Hbar.fromString(`${amount} ℏ`); // parse "0.005" as 0.005 HBAR

  const client = getClient();
  let transferResult;
  try {
    const tx = await new TransferTransaction()
      .addHbarTransfer(accountId, hbarAmount.negated())
      .addHbarTransfer(accountId, hbarAmount)
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
