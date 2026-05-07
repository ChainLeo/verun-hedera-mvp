/**
 * Verun Hedera MVP — Hedera SDK helpers
 * Centralised operator client + HCS topic management + Mirror Node access.
 *
 * Why HCS (Hedera Consensus Service):
 *   HCS is Hedera's purpose-built primitive for ordered, timestamped,
 *   immutable audit messages — submitMessage to a topic, $0.0001 per call,
 *   ABFT-ordered, retrievable from the public Mirror Node REST API.
 *   Exactly what a trust-verdict audit channel needs: cheap, public,
 *   verifiable, no Verun API required for read.
 */
require('dotenv').config();
const {
  Client,
  AccountId,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicInfoQuery,
  AccountBalanceQuery,
  Hbar,
} = require('@hashgraph/sdk');

// node-fetch v2 is CJS; native fetch is also available on Node 18+.
const fetchFn = globalThis.fetch ? globalThis.fetch.bind(globalThis) : require('node-fetch');

const HEDERA_NETWORK = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
const MIRROR_NODE_URL =
  process.env.MIRROR_NODE_URL ||
  (HEDERA_NETWORK === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : HEDERA_NETWORK === 'previewnet'
    ? 'https://previewnet.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com');

function normalize(raw) {
  return String(raw || '').trim().replace(/^['"`]+|['"`]+$/g, '');
}

function getClient() {
  const network = HEDERA_NETWORK;
  let client;
  if (network === 'mainnet') client = Client.forMainnet();
  else if (network === 'previewnet') client = Client.forPreviewnet();
  else client = Client.forTestnet();

  const opIdRaw = normalize(process.env.HEDERA_OPERATOR_ID);
  const opKeyRaw = normalize(process.env.HEDERA_OPERATOR_KEY);
  if (!opIdRaw) throw new Error('HEDERA_OPERATOR_ID env var missing');
  if (!opKeyRaw) throw new Error('HEDERA_OPERATOR_KEY env var missing');

  let operatorId, operatorKey;
  try {
    operatorId = AccountId.fromString(opIdRaw);
  } catch (e) {
    throw new Error(`HEDERA_OPERATOR_ID invalid (expected 0.0.X form): ${e.message}`);
  }
  try {
    operatorKey = PrivateKey.fromString(opKeyRaw);
  } catch (e) {
    throw new Error(`HEDERA_OPERATOR_KEY could not be decoded (expected DER 302e02... form): ${e.message}`);
  }
  client.setOperator(operatorId, operatorKey);
  // Reasonable fee/timeout defaults for Testnet:
  client.setDefaultMaxTransactionFee(new Hbar(2));
  client.setDefaultMaxQueryPayment(new Hbar(1));
  return client;
}

function getOperator() {
  const opIdRaw = normalize(process.env.HEDERA_OPERATOR_ID);
  const opKeyRaw = normalize(process.env.HEDERA_OPERATOR_KEY);
  if (!opIdRaw) throw new Error('HEDERA_OPERATOR_ID env var missing');
  if (!opKeyRaw) throw new Error('HEDERA_OPERATOR_KEY env var missing');
  const operatorId = AccountId.fromString(opIdRaw);
  const operatorKey = PrivateKey.fromString(opKeyRaw);
  return { operatorId, operatorKey, accountId: operatorId.toString() };
}

function getTopicId() {
  const raw = normalize(process.env.HEDERA_TOPIC_ID);
  if (!raw) {
    throw new Error(
      'HEDERA_TOPIC_ID env var missing. Run `npm run create-topic` to create one and paste it into .env / Vercel env.'
    );
  }
  return raw;
}

// ─── Explorer URLs (HashScan) ────────────────────────────────────────────────
function explorerNetwork() {
  return HEDERA_NETWORK === 'mainnet' ? 'mainnet' : HEDERA_NETWORK === 'previewnet' ? 'previewnet' : 'testnet';
}

function explorerTx(txId) {
  // HashScan transaction format: 0.0.X@seconds.nanos → URL-encoded
  return `https://hashscan.io/${explorerNetwork()}/transaction/${encodeURIComponent(String(txId))}`;
}

function explorerAccount(accountId) {
  return `https://hashscan.io/${explorerNetwork()}/account/${accountId}`;
}

function explorerTopic(topicId) {
  return `https://hashscan.io/${explorerNetwork()}/topic/${topicId}`;
}

function explorerMessage(topicId, sequenceNumber) {
  return `https://hashscan.io/${explorerNetwork()}/topic/${topicId}/message/${sequenceNumber}`;
}

// ─── Account balance / fund check ────────────────────────────────────────────
async function getAccountBalanceHbar(accountId) {
  const client = getClient();
  try {
    const bal = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
    return Number(bal.hbars.toBigNumber().toString());
  } finally {
    client.close();
  }
}

/**
 * No automatic faucet on Hedera — accounts are funded via the portal at
 * https://portal.hedera.com (testnet ships with 1000 HBAR per account).
 * This is a balance-check that returns hints if the operator is empty.
 */
async function ensureFunded(accountId, minHbar = 1) {
  let balance = 0;
  try {
    balance = await getAccountBalanceHbar(accountId);
  } catch (e) {
    return {
      funded: false,
      alreadyExisted: false,
      balance: 0,
      error: e.message,
      faucet: 'https://portal.hedera.com',
    };
  }
  return {
    funded: balance >= minHbar,
    alreadyExisted: true,
    balance,
    faucet: 'https://portal.hedera.com',
    hint:
      balance < minHbar
        ? `Operator balance ${balance} HBAR < ${minHbar} HBAR. Top up at https://portal.hedera.com.`
        : undefined,
  };
}

// ─── HCS topic management ────────────────────────────────────────────────────
/**
 * Create a fresh HCS topic. The operator becomes admin + submit key by
 * default (we omit the keys → topic is open for submission and immutable).
 * For the protocol-custodial Verun design we WANT the operator to be the
 * sole submitter so the topic is the canonical credential registry; we set
 * submitKey = operator public key to enforce that.
 */
async function createTopic({ memo = 'verun-mvp:vtrust-registry' } = {}) {
  const client = getClient();
  const { operatorKey } = getOperator();
  try {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setSubmitKey(operatorKey.publicKey)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId.toString();
    return {
      topicId,
      transactionId: tx.transactionId.toString(),
      explorer: explorerTopic(topicId),
    };
  } finally {
    client.close();
  }
}

async function getTopicInfo(topicId) {
  const client = getClient();
  try {
    const info = await new TopicInfoQuery().setTopicId(topicId).execute(client);
    return {
      topicId,
      memo: info.topicMemo,
      runningHash: Buffer.from(info.runningHash || []).toString('hex'),
      sequenceNumber: info.sequenceNumber.toString(),
      adminKey: info.adminKey ? info.adminKey.toString() : null,
      submitKey: info.submitKey ? info.submitKey.toString() : null,
    };
  } finally {
    client.close();
  }
}

/**
 * Submit a message to the configured topic. Returns
 * { sequenceNumber, transactionId, status, explorer }.
 */
async function submitTopicMessage(message) {
  if (!message) throw new Error('message required');
  const topicId = getTopicId();
  const client = getClient();
  try {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    return {
      topicId,
      sequenceNumber: receipt.topicSequenceNumber.toString(),
      transactionId: tx.transactionId.toString(),
      status: receipt.status.toString(),
      explorer: explorerTx(tx.transactionId.toString()),
      topic_explorer: explorerTopic(topicId),
    };
  } finally {
    client.close();
  }
}

// ─── Mirror Node REST helpers ────────────────────────────────────────────────
const MIRROR_DEFAULT_TIMEOUT_MS = 8000;

async function mirrorFetch(path, { timeoutMs = MIRROR_DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${MIRROR_NODE_URL}${path}`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetchFn(url, ctrl ? { signal: ctrl.signal } : {});
    if (!r.ok) throw new Error(`Mirror Node ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch HCS messages from the public Mirror Node REST API. Returns newest-
 * first by default (`order=desc`). Each message has a base64-encoded body.
 */
async function fetchTopicMessages(topicId, { limit = 100, order = 'desc' } = {}) {
  const path = `/api/v1/topics/${topicId}/messages?limit=${Math.max(1, Math.min(100, limit))}&order=${order}`;
  const data = await mirrorFetch(path);
  const out = (data.messages || []).map((m) => ({
    consensus_timestamp: m.consensus_timestamp,
    sequence_number: m.sequence_number,
    running_hash: m.running_hash,
    payer_account_id: m.payer_account_id,
    message: m.message,                                     // base64 string
    message_text: Buffer.from(m.message || '', 'base64').toString('utf8'),
    explorer: explorerMessage(topicId, m.sequence_number),
  }));
  return { topicId, count: out.length, messages: out, links: data.links || {} };
}

/**
 * Walk back through pages until `limit` messages are collected (or there is
 * no further page). Mirror Node caps per-call at 100; this loops with the
 * `links.next` cursor for higher SBT_SCAN_LIMIT values.
 */
async function fetchTopicMessagesPaged(topicId, { limit = 200 } = {}) {
  const all = [];
  let nextPath = `/api/v1/topics/${topicId}/messages?limit=100&order=desc`;
  while (nextPath && all.length < limit) {
    const data = await mirrorFetch(nextPath);
    const slice = (data.messages || []).map((m) => ({
      consensus_timestamp: m.consensus_timestamp,
      sequence_number: m.sequence_number,
      running_hash: m.running_hash,
      payer_account_id: m.payer_account_id,
      message: m.message,
      message_text: Buffer.from(m.message || '', 'base64').toString('utf8'),
      explorer: explorerMessage(topicId, m.sequence_number),
    }));
    all.push(...slice);
    nextPath = (data.links && data.links.next) ? data.links.next : null;
    if (slice.length === 0) break;
  }
  return { topicId, count: Math.min(all.length, limit), messages: all.slice(0, limit) };
}

async function getTopicInfoMirror(topicId) {
  return await mirrorFetch(`/api/v1/topics/${topicId}`);
}

async function getAccountInfoMirror(accountId) {
  return await mirrorFetch(`/api/v1/accounts/${accountId}`);
}

module.exports = {
  // SDK re-exports for callers that need direct access
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicInfoQuery,
  AccountBalanceQuery,

  // Config / network
  HEDERA_NETWORK,
  MIRROR_NODE_URL,

  // Operator / client
  getClient,
  getOperator,
  getTopicId,

  // Funding / balance
  ensureFunded,
  getAccountBalanceHbar,

  // Topic ops
  createTopic,
  getTopicInfo,
  submitTopicMessage,

  // Mirror Node
  fetchTopicMessages,
  fetchTopicMessagesPaged,
  getTopicInfoMirror,
  getAccountInfoMirror,

  // Explorer URLs
  explorerTx,
  explorerAccount,
  explorerTopic,
  explorerMessage,
  explorerNetwork,
};
