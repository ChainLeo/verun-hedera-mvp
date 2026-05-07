module.exports = async function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'verun-hedera-mvp',
    network: `hedera-${process.env.HEDERA_NETWORK || 'testnet'}`,
  });
};
