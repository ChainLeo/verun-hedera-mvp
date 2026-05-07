/**
 * Print operator account, balance, and (if configured) topic info.
 * Usage: npm run check
 */
require('dotenv').config();
const {
  getOperator,
  getAccountBalanceHbar,
  getTopicInfoMirror,
  explorerAccount,
  explorerTopic,
  HEDERA_NETWORK,
} = require('../src/hedera');

(async () => {
  const { accountId } = getOperator();
  const hbar = await getAccountBalanceHbar(accountId);

  console.log('network        :', `hedera-${HEDERA_NETWORK}`);
  console.log('account_id     :', accountId);
  console.log('balance_hbar   :', hbar);
  console.log('balance_tinybar:', Math.round(hbar * 1e8));
  console.log('explorer       :', explorerAccount(accountId));

  const topicId = (process.env.HEDERA_TOPIC_ID || '').trim();
  if (topicId) {
    try {
      const info = await getTopicInfoMirror(topicId);
      console.log('topic_id       :', info.topic_id);
      console.log('topic_memo     :', info.memo);
      console.log('topic_deleted  :', info.deleted ?? false);
      console.log('topic_explorer :', explorerTopic(topicId));
    } catch (e) {
      console.log('topic_id       :', topicId, '(mirror node lookup failed:', e.message + ')');
    }
  } else {
    console.log('topic_id       : (unset — run `npm run create-topic`)');
  }
})().catch((e) => {
  console.error('ERR:', e.message || e);
  process.exit(1);
});
