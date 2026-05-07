/**
 * Generate a fresh ED25519 keypair locally.
 *
 * Hedera does not expose a faucet endpoint that funds an arbitrary public
 * key. To get a testnet account ID for this key, log into
 *   https://portal.hedera.com  →  Testnet  →  Create Account
 * and either (a) let the portal generate the keypair (preferred — its
 * key + account ID are paired and pre-funded with 1000 HBAR), or
 * (b) paste the public key printed below to associate this local key
 * with a new account.
 *
 * Output:
 *   HEDERA_OPERATOR_KEY (DER private key, 302e0201...)
 *   HEDERA_PUBLIC_KEY   (DER public key, for portal "create from public key" flow)
 *
 * SECURITY NOTE: this private key has touched a chat / log / shell. If you
 * use it on mainnet, ROTATE FIRST. For Testnet, fine.
 */
const { PrivateKey } = require('@hashgraph/sdk');

const kp = PrivateKey.generateED25519();
const sec = kp.toString();          // DER 302e0201...
const pub = kp.publicKey.toString(); // DER 302a3005...

console.log('────────────────────────────────────────────────────────────');
console.log(' Hedera ED25519 keypair (Testnet)');
console.log('────────────────────────────────────────────────────────────');
console.log(' HEDERA_OPERATOR_KEY =', sec);
console.log(' HEDERA_PUBLIC_KEY   =', pub);
console.log('────────────────────────────────────────────────────────────');
console.log('');
console.log(' To get a HEDERA_OPERATOR_ID:');
console.log('   1) Open https://portal.hedera.com → Testnet → Create Account');
console.log('   2) EITHER let the portal generate the keypair (recommended) —');
console.log('      then DISCARD the keys printed above and use the portal');
console.log('      keys instead;');
console.log('   3) OR paste the HEDERA_PUBLIC_KEY above into the portal\'s');
console.log('      "create from public key" flow. The portal will return');
console.log('      a new HEDERA_OPERATOR_ID (0.0.x) pre-funded with 1000 HBAR.');
console.log('');
console.log(' Save the SECRET above somewhere safe — it cannot be recovered.');
console.log(' Set HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY in .env / Vercel env.');
console.log('');
console.log(' ⚠  This private key was printed to stdout. If you ever use it on');
console.log('    mainnet, ROTATE FIRST.');
