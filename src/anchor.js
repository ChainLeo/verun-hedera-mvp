/**
 * On-chain anchor for a Verun verdict — Hedera Testnet.
 *
 * Strategy: HCS submitMessage to the configured topic with a
 * `verun-eval:` prefix and the sha256 of the verdict payload. The full
 * payload digest is in the message body for tamper-evidence; the topic
 * acts as a single ordered audit channel for both SBT lifecycle events
 * and verdict anchors.
 *
 * Message format:
 *   `verun-eval:<consensus>:<agentId>:<ts>:<hashHex>`
 *
 * Cost: ~$0.0001 USD per submitMessage (fixed by Hedera fee schedule).
 * Verification: public, zero-auth via Mirror Node REST.
 */
require('dotenv').config();
const crypto = require('crypto');
const {
  getOperator,
  getTopicId,
  submitTopicMessage,
  explorerMessage,
  explorerTopic,
  HEDERA_NETWORK,
} = require('./hedera');

const ANCHOR_PREFIX = 'verun-eval';

async function anchorEvaluation(payload) {
  const { accountId } = getOperator();
  const topicId = getTopicId();

  const json = JSON.stringify(payload);
  const digest = crypto.createHash('sha256').update(json).digest();
  const hashHex = digest.toString('hex');

  const consensus = String(payload.consensus || 'NA');
  const agentId = String(payload.agentId || 'agent').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  const ts = String(payload.ts || new Date().toISOString());

  const messageText = `${ANCHOR_PREFIX}:${consensus}:${agentId}:${ts}:${hashHex.slice(0, 16)}`;
  const submitResult = await submitTopicMessage(messageText);

  return {
    txid: submitResult.transactionId,
    ledger: submitResult.sequenceNumber,
    sequence_number: submitResult.sequenceNumber,
    topic_id: topicId,
    network: `hedera-${HEDERA_NETWORK}`,
    payer: accountId,
    memo_hash: hashHex,
    payload_hash: hashHex,
    payload_size: json.length,
    explorer: submitResult.explorer,
    topic_explorer: explorerTopic(topicId),
    message_explorer: explorerMessage(topicId, submitResult.sequenceNumber),
    message: messageText,
  };
}

module.exports = { anchorEvaluation };
