/**
 * Submit a single self-test HCS message and print the resulting transaction
 * id + sequence number + HashScan link.
 * Usage: npm run selftx
 */
require('dotenv').config();
const crypto = require('crypto');
const { submitTopicMessage, getTopicId } = require('../src/hedera');

(async () => {
  const topicId = getTopicId();
  const payload = `verun-selftest-${Date.now()}`;
  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  const messageText = `verun-selftest:${payload}:${digest}`;

  const result = await submitTopicMessage(messageText);

  console.log('topic_id       :', topicId);
  console.log('message        :', messageText);
  console.log('sequence_number:', result.sequenceNumber);
  console.log('transaction_id :', result.transactionId);
  console.log('status         :', result.status);
  console.log('explorer       :', result.explorer);
  console.log('topic_explorer :', result.topic_explorer);
})().catch((e) => {
  console.error('ERR:', e.message || e);
  process.exit(1);
});
