# AGENT.md — orientation for future Claude / dev sessions

## What this repo is

Verun is an AI Agent Trust Layer built on **Hedera Testnet**. The protocol issues compliance-grade trust verdicts for AI agents, anchors them to HCS for public verifiability, and exposes an x402-paid evaluation endpoint so agents can pay-per-call without subscriptions.

Backend surface: validator consensus (`src/evaluate.js`), HCS anchor (`src/anchor.js`), Hedera SDK adapter (`src/hedera.js`), SBT lifecycle (`src/sbt.js`), x402 facilitator integration (`src/x402.js`), Stablecoin Studio compatibility (`src/stablecoin.js`).

## On-chain primitive

Hedera Consensus Service (HCS) topics. One dedicated topic for the protocol; the operator key is the topic's `submitKey` so only the protocol can publish, but anyone can read via Mirror Node REST.

Three event prefixes share the topic:

- `vtrust-mint:<agentId>:<tier>:<score>:<ts>:<hash8>`
- `vtrust-revoke:<agentId>:<reason>:<ts>:<hash8>`
- `verun-eval:<consensus>:<agentId>:<ts>:<hash16>` (anchor for `/api/evaluate`)

`<hash8>` / `<hash16>` is a sha256 prefix of the full payload JSON, kept short so the message stays under HCS's 1024-byte cap. Latest event per `agentId` wins for SBT status.

## Files that matter

```
src/
  hedera.js         ← chain adapter (Client, operator, topic, Mirror Node)
  sbt.js            ← mint / revoke / status / list (HCS-backed)
  anchor.js         ← /api/evaluate verdict anchor
  evaluate.js       ← validator consensus engine (chain-agnostic)
  x402.js           ← x402 paymentRequirements builder + facilitator verify/settle
  stablecoin.js     ← Stablecoin Studio-compatible HTS token info layer
  validatorAdapters.js
  validators.json
  api.js            ← Express entrypoint for `npm run api`
api/                ← Vercel serverless route handlers
scripts/
  check.js          ← print account + balance + topic info
  genkey.js         ← generate fresh ED25519 keypair (testnet only)
  create-topic.js   ← create the dedicated HCS topic
  selftx.js         ← submit one HCS message as a smoke test
  verify.js         ← end-to-end live 5-tick verification
  sbt-demo.sh       ← lifecycle demo curling the deployed API
  smoke-live.sh     ← 5-step API smoke test
index.html, docs.html, competitive-landscape.html
```

## Common tasks

- **Add a field to the SBT message.** Edit `encodeMintMessage` / `parseMessage` in `src/sbt.js`. Bump the format version in the prefix if you break compatibility (`vtrust-mint:v2:...`).
- **Switch to HTS NFTs.** Replace the `submitTopicMessage` calls inside `mintSBT` / `revokeSBT` with `TokenCreateTransaction` + `TokenMintTransaction`. Status becomes a Mirror Node NFT query. The HCS topic stays as the audit channel — log the NFT mint tx id into the topic.
- **Self-host a Mirror Node.** Set `MIRROR_NODE_URL` to your private endpoint. The REST shape is identical to public testnet.
- **Add an indexer.** Subscribe via gRPC `SubscribeQuery`, fold to Postgres. The API surface stays unchanged.

## Things to NOT do

- Don't commit `.env`. The `.gitignore` is set up to ignore it.
- Don't generate a key in `npm run genkey` and use it on mainnet — it has touched logs/stdout. Always rotate before mainnet.
- Don't claim "X green ticks" if you ran against a mocked client. The 5 ticks in `npm run verify` go through real Hedera Testnet + real Mirror Node.

## Architecture story for the pitch

- Hedera Council = enterprise governance (Boeing, Google, IBM, Deutsche Telekom). Strong EU regulatory framing.
- ABFT consensus = provably fair message ordering, no leader, no fork.
- HCS = purpose-built audit channel at $0.0001 per message.
- Carbon-negative = ESG angle for compliance pitch.
- Mirror Node REST = free public verification, no Verun API needed for status checks.

Compliance story: MiCA Art. 68 / EU AI Act Art. 14 / MiFID II Art. 17 — protocol-custodial, single responsible party (BCP Partners GmbH), kill-switch via revoke (HCS `vtrust-revoke:` message).
