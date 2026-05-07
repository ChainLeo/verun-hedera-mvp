const {
  AccountId,
  PrivateKey,
  HEDERA_NETWORK,
  MIRROR_NODE_URL,
  getTopicInfoMirror,
} = require('../src/hedera');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const operatorIdRaw = process.env.HEDERA_OPERATOR_ID || '';
  const operatorKeyRaw = process.env.HEDERA_OPERATOR_KEY || '';
  const topicIdRaw = process.env.HEDERA_TOPIC_ID || '';

  let operatorIdValid = false;
  let operatorIdParsed = null;
  let operatorIdError = null;
  if (operatorIdRaw) {
    try {
      operatorIdParsed = AccountId.fromString(operatorIdRaw.trim()).toString();
      operatorIdValid = true;
    } catch (e) {
      operatorIdError = e.message || String(e);
    }
  }

  let operatorKeyValid = false;
  let operatorKeyType = null;
  let operatorKeyPublic = null;
  let operatorKeyError = null;
  if (operatorKeyRaw) {
    try {
      const k = PrivateKey.fromString(operatorKeyRaw.trim());
      operatorKeyValid = true;
      operatorKeyType = k._key && k._key.constructor && k._key.constructor.name ? k._key.constructor.name : 'unknown';
      operatorKeyPublic = k.publicKey.toString();
    } catch (e) {
      operatorKeyError = e.message || String(e);
    }
  }

  let topicIdValid = false;
  let topicInfo = null;
  let topicError = null;
  if (topicIdRaw) {
    try {
      topicInfo = await getTopicInfoMirror(topicIdRaw.trim());
      topicIdValid = true;
    } catch (e) {
      topicError = e.message || String(e);
    }
  }

  let mirrorReachable = false;
  let mirrorStatus = null;
  let mirrorError = null;
  try {
    const r = await fetch(`${MIRROR_NODE_URL}/api/v1/network/nodes?limit=1`);
    mirrorStatus = r.status;
    mirrorReachable = r.ok;
  } catch (e) {
    mirrorError = e.message || String(e);
  }

  return res.status(200).json({
    ok: true,
    network: `hedera-${HEDERA_NETWORK}`,
    checks: {
      operator_id_present: Boolean(operatorIdRaw),
      operator_id_valid: operatorIdValid,
      operator_id_error: operatorIdError,
      operator_id_parsed: operatorIdParsed,

      operator_key_present: Boolean(operatorKeyRaw),
      operator_key_valid: operatorKeyValid,
      operator_key_error: operatorKeyError,
      operator_key_type: operatorKeyType,
      operator_key_public: operatorKeyPublic,

      topic_id_present: Boolean(topicIdRaw),
      topic_id_valid: topicIdValid,
      topic_id_error: topicError,
      topic_info: topicInfo
        ? { topic_id: topicInfo.topic_id, memo: topicInfo.memo, deleted: topicInfo.deleted }
        : null,

      mirror_node_url: MIRROR_NODE_URL,
      mirror_reachable: mirrorReachable,
      mirror_status: mirrorStatus,
      mirror_error: mirrorError,
    },
    hints: [
      'If operator_key_valid=false, ensure HEDERA_OPERATOR_KEY is the DER-encoded private key (302e0201...).',
      'If topic_id_present=false, run `npm run create-topic` and paste HEDERA_TOPIC_ID into Vercel env.',
      'After fixing env vars, redeploy and retest /api/funding-status + /api/evaluate + /api/sbt-list.',
    ],
  });
};
