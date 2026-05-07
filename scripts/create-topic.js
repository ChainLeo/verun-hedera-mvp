/**
 * Create a dedicated HCS topic for the Verun protocol and print
 * HEDERA_TOPIC_ID for you to paste into .env / Vercel env.
 *
 * The operator becomes the sole submitKey, so only the protocol can
 * write vtrust-mint / vtrust-revoke / verun-eval messages. Anyone can
 * read the topic via the Mirror Node REST API.
 *
 * Usage: npm run create-topic
 */
require('dotenv').config();
const { createTopic, explorerTopic, HEDERA_NETWORK } = require('../src/hedera');

(async () => {
  console.log(`Creating HCS topic on hedera-${HEDERA_NETWORK}…`);
  const result = await createTopic({ memo: 'verun-mvp:vtrust-registry' });
  console.log('────────────────────────────────────────────────────────────');
  console.log(' HCS topic created');
  console.log('────────────────────────────────────────────────────────────');
  console.log(' HEDERA_TOPIC_ID =', result.topicId);
  console.log(' transaction id  :', result.transactionId);
  console.log(' explorer        :', explorerTopic(result.topicId));
  console.log('────────────────────────────────────────────────────────────');
  console.log('');
  console.log(' Paste HEDERA_TOPIC_ID into your .env (and Vercel env vars).');
})().catch((e) => {
  console.error('ERR:', e.message || e);
  process.exit(1);
});
