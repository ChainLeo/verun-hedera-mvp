/**
 * Verun SBT — Protocol-custodial Soulbound credential on Hedera Testnet.
 *
 * Architecture:
 *   • Agent identity is the `agentId` STRING. Agents do NOT hold keys —
 *     this is the EU AI Act / MiFID II "single responsible party" model.
 *   • The credential registry is a dedicated HCS topic. Every event is a
 *     submitMessage transaction with a `vtrust-` prefix.
 *   • `mint`   = HCS message `vtrust-mint:<agentId>:<tier>:<score>:<ts>:<hash8>`
 *   • `revoke` = HCS message `vtrust-revoke:<agentId>:<reason>:<ts>:<hash8>`
 *   • `status` and `list` = read messages from Mirror Node REST, parse
 *     prefixes, fold by latest event per agentId.
 *
 * Why HCS messages vs. HTS NFT-per-agent (for the MVP):
 *   HCS gives ordered, timestamped, immutable messages at $0.0001 each
 *   with a free public Mirror Node REST API for verification — the
 *   "anyone can verify on-chain, no Verun API needed" property. HTS
 *   NFT-per-agent is a truer "soulbound token" semantic but adds per-agent
 *   token creation cost + complexity. The /api/{mint,revoke,status,list}-sbt
 *   surface is identical, so the swap stays local to this file.
 *
 * Upgrade path (post-MVP):
 *   Replace the mint/revoke calls with TokenCreateTransaction (NFT) +
 *   TokenMintTransaction / TokenBurnTransaction; status becomes a
 *   getTokenNftInfo or Mirror Node /api/v1/tokens/{tokenId}/nfts query.
 *   The HCS topic stays as the audit channel.
 */
require('dotenv').config();
const crypto = require('crypto');
const {
  getOperator,
  getTopicId,
  submitTopicMessage,
  fetchTopicMessagesPaged,
  explorerTx,
  explorerAccount,
  explorerTopic,
  explorerMessage,
  HEDERA_NETWORK,
} = require('./hedera');

const MAX_AGENT_LEN = 50;
const MEMO_PREFIX_MINT = 'vtrust-mint';
const MEMO_PREFIX_REVOKE = 'vtrust-revoke';
// HCS messages can be up to ~1024 bytes — we keep ours tight for
// explorer readability and cheap parsing.

function tierFromScore(score) {
  if (score >= 800) return 'LOW';
  if (score >= 600) return 'MED';
  if (score >= 300) return 'HIGH';
  return 'BLOCK';
}

function safeAgentKey(agentId) {
  return String(agentId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_AGENT_LEN);
}

// ────────────────────────────────────────────────────────────────────
// Message encoding/parsing
// Format: `vtrust-mint:<agentId>:<tier>:<score>:<isoTs>:<hash8>`
//         `vtrust-revoke:<agentId>:<reason>:<isoTs>:<hash8>`
// `<hash8>` is the first 8 hex chars of sha256(payloadJson) — for
// tamper-evidence; the full hash is logged in the response.
// ────────────────────────────────────────────────────────────────────
function encodeMintMessage({ agentId, tier, score, ts, hashHex }) {
  return `${MEMO_PREFIX_MINT}:${agentId}:${tier}:${score}:${ts}:${hashHex.slice(0, 8)}`;
}
function encodeRevokeMessage({ agentId, reason, ts, hashHex }) {
  const safeReason = String(reason || 'unspecified').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  return `${MEMO_PREFIX_REVOKE}:${agentId}:${safeReason}:${ts}:${hashHex.slice(0, 8)}`;
}

function parseMessage(text) {
  if (!text || typeof text !== 'string') return null;
  if (text.startsWith(MEMO_PREFIX_MINT + ':')) {
    const parts = text.split(':');
    if (parts.length < 6) return null;
    const [, agentId, tier, score, ...rest] = parts;
    const hash8 = rest.pop();
    const ts = rest.join(':');
    return { kind: 'mint', agentId, tier, score: Number(score), ts, hash8 };
  }
  if (text.startsWith(MEMO_PREFIX_REVOKE + ':')) {
    const parts = text.split(':');
    if (parts.length < 5) return null;
    const [, agentId, reason, ...rest] = parts;
    const hash8 = rest.pop();
    const ts = rest.join(':');
    return { kind: 'revoke', agentId, reason, ts, hash8 };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// MINT — issue / refresh credential
// ────────────────────────────────────────────────────────────────────
async function mintSBT({ agentId, score }) {
  if (!agentId) throw new Error('agentId required');
  score = Number(score);
  if (Number.isNaN(score)) throw new Error('score must be a number');
  if (score < 300) {
    throw new Error(`score ${score} below minimum SBT threshold (300). Verdict was BLOCK.`);
  }

  const tier = tierFromScore(score);
  const ts = new Date().toISOString();
  const safeId = safeAgentKey(agentId);
  const credentialPayload = { type: 'verun-sbt', agentId: safeId, tier, score, ts };
  const credentialHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(credentialPayload))
    .digest();
  const hashHex = credentialHash.toString('hex');
  const messageText = encodeMintMessage({ agentId: safeId, tier, score, ts, hashHex });

  const { accountId } = getOperator();
  const topicId = getTopicId();
  const submitResult = await submitTopicMessage(messageText);

  return {
    success: true,
    agentId: safeId,
    tier,
    score,
    ts,
    key: `vtrust_${safeId}`, // stable client-side key derived from agentId
    txid: submitResult.transactionId,
    ledger: submitResult.sequenceNumber, // HCS sequence number is the linear "ledger" id
    sequence_number: submitResult.sequenceNumber,
    topic_id: topicId,
    credential_hash: hashHex,
    network: `hedera-${HEDERA_NETWORK}`,
    issuer: accountId,
    explorer: submitResult.explorer,
    topic_explorer: explorerTopic(topicId),
    message_explorer: explorerMessage(topicId, submitResult.sequenceNumber),
    issuer_explorer: explorerAccount(accountId),
    message: messageText,
  };
}

// ────────────────────────────────────────────────────────────────────
// REVOKE — kill-switch (writes a vtrust-revoke message to the topic)
// ────────────────────────────────────────────────────────────────────
async function revokeSBT({ agentId, reason = 'unspecified' }) {
  if (!agentId) throw new Error('agentId required');
  const safeId = safeAgentKey(agentId);
  const ts = new Date().toISOString();
  const revokePayload = { type: 'verun-sbt-revoke', agentId: safeId, reason, ts };
  const revokeHash = crypto.createHash('sha256').update(JSON.stringify(revokePayload)).digest();
  const hashHex = revokeHash.toString('hex');
  const messageText = encodeRevokeMessage({ agentId: safeId, reason, ts, hashHex });

  const { accountId } = getOperator();
  const topicId = getTopicId();
  const submitResult = await submitTopicMessage(messageText);

  return {
    success: true,
    revoked: true,
    agentId: safeId,
    key: `vtrust_${safeId}`,
    reason,
    ts,
    txid: submitResult.transactionId,
    ledger: submitResult.sequenceNumber,
    sequence_number: submitResult.sequenceNumber,
    topic_id: topicId,
    revoke_hash: hashHex,
    explorer: submitResult.explorer,
    message_explorer: explorerMessage(topicId, submitResult.sequenceNumber),
    issuer_explorer: explorerAccount(accountId),
    message: messageText,
  };
}

// ────────────────────────────────────────────────────────────────────
// SCAN — pull recent vtrust messages from the configured HCS topic
// ────────────────────────────────────────────────────────────────────
const SCAN_LIMIT = Number(process.env.SBT_SCAN_LIMIT || 200);

async function scanCredentialEvents({ limit = SCAN_LIMIT } = {}) {
  const topicId = getTopicId();
  const { messages } = await fetchTopicMessagesPaged(topicId, { limit });
  // Mirror Node returns newest-first when order=desc (default in our helper).
  const events = [];
  for (const m of messages) {
    const parsed = parseMessage(m.message_text);
    if (!parsed) continue;
    events.push({
      ...parsed,
      txid: null, // Mirror Node messages are addressed by sequence number, not tx hash
      sequence_number: m.sequence_number,
      consensus_timestamp: m.consensus_timestamp,
      payer_account_id: m.payer_account_id,
      explorer: m.explorer,
    });
  }
  return { topicId, events };
}

/**
 * Fold the event stream into per-agent current state. Newest event wins.
 */
function foldEventsToState(events) {
  const seen = new Set();
  const state = {}; // agentId -> latest event
  // events arrive newest-first → first occurrence per agentId IS the latest.
  for (const e of events) {
    if (seen.has(e.agentId)) continue;
    seen.add(e.agentId);
    state[e.agentId] = e;
  }
  return state;
}

// ────────────────────────────────────────────────────────────────────
// STATUS — read latest credential event for a single agent
// ────────────────────────────────────────────────────────────────────
async function statusSBT({ agentId }) {
  if (!agentId) throw new Error('agentId required');
  const safeId = safeAgentKey(agentId);
  const { accountId } = getOperator();
  const { topicId, events } = await scanCredentialEvents();
  const state = foldEventsToState(events);
  const latest = state[safeId];

  if (!latest) {
    return {
      ok: true,
      agentId: safeId,
      credentialed: false,
      key: `vtrust_${safeId}`,
      issuer: accountId,
      topic_id: topicId,
      issuer_explorer: explorerAccount(accountId),
      topic_explorer: explorerTopic(topicId),
    };
  }

  if (latest.kind === 'revoke') {
    return {
      ok: true,
      agentId: safeId,
      credentialed: false,
      key: `vtrust_${safeId}`,
      issuer: accountId,
      topic_id: topicId,
      last_event: latest,
      issuer_explorer: explorerAccount(accountId),
      topic_explorer: explorerTopic(topicId),
    };
  }

  // mint event — currently credentialed
  return {
    ok: true,
    agentId: safeId,
    credentialed: true,
    key: `vtrust_${safeId}`,
    issuer: accountId,
    topic_id: topicId,
    credential: {
      tier: latest.tier,
      score: latest.score,
      ts: latest.ts,
    },
    last_event: latest,
    issuer_explorer: explorerAccount(accountId),
    topic_explorer: explorerTopic(topicId),
    verify_url: latest.explorer,
  };
}

// ────────────────────────────────────────────────────────────────────
// LIST — every currently-credentialed agent under this issuer
// ────────────────────────────────────────────────────────────────────
async function listSBT() {
  const { accountId } = getOperator();
  const { topicId, events } = await scanCredentialEvents();
  const state = foldEventsToState(events);
  const credentials = [];
  for (const [agentId, ev] of Object.entries(state)) {
    if (ev.kind !== 'mint') continue;
    credentials.push({
      key: `vtrust_${agentId}`,
      agentId,
      credential: { tier: ev.tier, score: ev.score, ts: ev.ts },
      sequence_number: ev.sequence_number,
      consensus_timestamp: ev.consensus_timestamp,
      explorer: ev.explorer,
    });
  }
  return {
    ok: true,
    issuer: accountId,
    topic_id: topicId,
    issuer_explorer: explorerAccount(accountId),
    topic_explorer: explorerTopic(topicId),
    total: credentials.length,
    credentials,
    scanned_events: events.length,
  };
}

module.exports = {
  mintSBT,
  revokeSBT,
  statusSBT,
  listSBT,
  tierFromScore,
  // exported for tests
  encodeMintMessage,
  encodeRevokeMessage,
  parseMessage,
  foldEventsToState,
};
