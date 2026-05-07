/**
 * Verun Hedera MVP — end-to-end live verification (5 green ticks).
 *
 * Prereqs (.env):
 *   HEDERA_OPERATOR_ID = 0.0.X       (testnet account, ≥1 HBAR)
 *   HEDERA_OPERATOR_KEY = 302e0201…  (DER ED25519 private key)
 *   HEDERA_TOPIC_ID = 0.0.Y          (run `npm run create-topic` if missing)
 *
 * What it checks (against real Hedera Testnet — NO mocks):
 *   1) Operator account reachable, balance > 0 HBAR
 *   2) HCS topic exists and is readable from Mirror Node REST
 *   3) Mint SBT — submitMessage with vtrust-mint prefix returns a valid sequence number
 *   4) Status — Mirror Node ingests the message; statusSBT confirms credentialed=true with correct tier+score
 *   5) Revoke + status — vtrust-revoke message lands; statusSBT confirms credentialed=false
 *
 * Each tick prints the actual on-chain transaction id + HashScan link.
 *
 * Usage: npm run verify
 *
 * Mirror Node ingestion latency on Testnet is ~3–6 seconds — the script
 * polls (max 30s per check) before failing.
 */
require('dotenv').config();
const {
  getOperator,
  getTopicId,
  getAccountBalanceHbar,
  getTopicInfoMirror,
  explorerAccount,
  explorerTopic,
  HEDERA_NETWORK,
  MIRROR_NODE_URL,
} = require('../src/hedera');
const { mintSBT, revokeSBT, statusSBT } = require('../src/sbt');

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const tick = G('✓');
const cross = R('✗');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollUntil(fn, { max = 30000, interval = 1500, label = '' } = {}) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < max) {
    try {
      const r = await fn();
      if (r) return r;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`pollUntil timed out (${label}): ${lastErr ? lastErr.message : 'condition false'}`);
}

(async () => {
  console.log();
  console.log(B('┌─ Verun Hedera MVP — Live Verification (5 ticks) ─────────────┐'));
  console.log(B(`│ Network: hedera-${HEDERA_NETWORK}    Mirror Node: ${MIRROR_NODE_URL}`));
  console.log(B('└──────────────────────────────────────────────────────────────┘'));
  console.log();

  // ─── 1. OPERATOR REACHABLE + FUNDED ───────────────────────────────
  console.log(B('[1/5]') + ' ' + Y('Checking operator account on real Testnet…'));
  const { accountId } = getOperator();
  const balance = await getAccountBalanceHbar(accountId);
  if (balance < 1) throw new Error(`Operator balance ${balance} HBAR < 1. Top up at https://portal.hedera.com.`);
  console.log(`      ${tick} operator    : ${accountId}`);
  console.log(`        balance     : ${balance} HBAR`);
  console.log(`        explorer    : ${explorerAccount(accountId)}`);
  console.log();

  // ─── 2. HCS TOPIC EXISTS + READABLE FROM MIRROR NODE ──────────────
  console.log(B('[2/5]') + ' ' + Y('Verifying HCS topic via Mirror Node REST…'));
  const topicId = getTopicId();
  const topicInfo = await getTopicInfoMirror(topicId);
  if (topicInfo.deleted) throw new Error(`Topic ${topicId} is marked deleted on Mirror Node.`);
  console.log(`      ${tick} topic_id    : ${topicId}`);
  console.log(`        memo        : ${topicInfo.memo}`);
  console.log(`        admin_key   : ${topicInfo.admin_key ? '(set)' : '(unset)'}`);
  console.log(`        submit_key  : ${topicInfo.submit_key ? '(set)' : '(unset, open)'}`);
  console.log(`        explorer    : ${explorerTopic(topicId)}`);
  console.log();

  // ─── 3. MINT SBT ──────────────────────────────────────────────────
  const stamp = Date.now().toString(36);
  const agentId = `verify_${stamp}`;
  const score = 720; // MED tier
  console.log(B('[3/5]') + ' ' + Y(`Minting VTRUST SBT for agent ${agentId} (score ${score})…`));
  const mint = await mintSBT({ agentId, score });
  if (!mint.success) throw new Error(`mintSBT returned success=false: ${JSON.stringify(mint)}`);
  if (mint.tier !== 'MED') throw new Error(`expected tier MED, got ${mint.tier}`);
  console.log(`      ${tick} tier        : ${mint.tier}`);
  console.log(`        score       : ${mint.score}`);
  console.log(`        sequence_no : ${mint.sequence_number}`);
  console.log(`        tx_id       : ${mint.txid}`);
  console.log(`        msg_explorer: ${mint.message_explorer}`);
  console.log();

  // ─── 4. STATUS — POLL MIRROR NODE UNTIL INGESTED ──────────────────
  console.log(B('[4/5]') + ' ' + Y('Polling Mirror Node until mint message is ingested…'));
  const t0 = Date.now();
  const st = await pollUntil(async () => {
    const s = await statusSBT({ agentId });
    if (s.credentialed && s.credential && Number(s.credential.score) === score && s.credential.tier === 'MED') {
      return s;
    }
    return null;
  }, { max: 30000, interval: 1500, label: 'mint ingestion' });
  const elapsed = Date.now() - t0;
  console.log(`      ${tick} credentialed: true`);
  console.log(`        tier        : ${st.credential.tier}`);
  console.log(`        score       : ${st.credential.score}`);
  console.log(`        ingestion   : ${elapsed} ms (Mirror Node)`);
  console.log(`        verify_url  : ${st.verify_url || st.last_event && st.last_event.explorer}`);
  console.log();

  // ─── 5. REVOKE + STATUS ───────────────────────────────────────────
  console.log(B('[5/5]') + ' ' + Y('Revoking credential (kill-switch) and re-verifying…'));
  const rev = await revokeSBT({ agentId, reason: 'verify_kill_switch' });
  if (!rev.success || !rev.revoked) throw new Error(`revokeSBT returned ${JSON.stringify(rev)}`);
  console.log(`        revoke seq  : ${rev.sequence_number}`);
  console.log(`        revoke tx   : ${rev.txid}`);
  console.log(`        revoke url  : ${rev.message_explorer}`);

  const t1 = Date.now();
  const st2 = await pollUntil(async () => {
    const s = await statusSBT({ agentId });
    if (!s.credentialed && s.last_event && s.last_event.kind === 'revoke') return s;
    return null;
  }, { max: 30000, interval: 1500, label: 'revoke ingestion' });
  const elapsed2 = Date.now() - t1;
  console.log(`      ${tick} credentialed: false (kill-switch confirmed)`);
  console.log(`        last_event  : ${st2.last_event.kind}@seq ${st2.last_event.sequence_number}`);
  console.log(`        ingestion   : ${elapsed2} ms (Mirror Node)`);
  console.log();

  // ─── SUMMARY ──────────────────────────────────────────────────────
  console.log(B('┌─ All five ticks green ────────────────────────────────────────┐'));
  console.log(`│ ${tick} 1. Operator reachable and funded`);
  console.log(`│ ${tick} 2. HCS topic exists, Mirror Node returns metadata`);
  console.log(`│ ${tick} 3. Mint submitMessage confirmed (sequence ${mint.sequence_number})`);
  console.log(`│ ${tick} 4. statusSBT confirms credentialed=true (tier ${st.credential.tier})`);
  console.log(`│ ${tick} 5. Revoke confirmed (sequence ${rev.sequence_number}); statusSBT credentialed=false`);
  console.log(B('└───────────────────────────────────────────────────────────────┘'));
  console.log();
  console.log(`        agent_id    : ${agentId}`);
  console.log(`        topic       : ${explorerTopic(topicId)}`);
  console.log();
})().catch((e) => {
  console.error();
  console.error(R('VERIFICATION FAILED:'), e.message || e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
