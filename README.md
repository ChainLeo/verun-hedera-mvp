# Verun Hedera MVP

The Trust Layer for Agentic Finance — anchored on **Hedera Testnet** via the Hedera Consensus Service (HCS).

A 2-of-3 validator consensus protocol that scores AI agents and writes every verdict to Hedera as an HCS message (sha256 of the verdict payload, anchored via `TopicMessageSubmitTransaction` on a dedicated protocol topic).

Live deployment: [hedera.erster.fund](https://hedera.erster.fund) · GitHub: [ChainLeo/verun-hedera-mvp](https://github.com/ChainLeo/verun-hedera-mvp)

> **Why Hedera.** Governed by an enterprise council (Boeing, Google, IBM, Deutsche Telekom, et al.) — strong EU regulatory story. ABFT consensus gives provably fair message ordering. HCS is the purpose-built primitive for ordered, timestamped, immutable audit messages — exactly what Verun needs — at a fixed ~$0.0001 per submitMessage. Mirror Node REST is free, public, and zero-auth for on-chain verification.

> **Secrets policy.** `.env.example` ships with placeholders only. Real keys live in your local `.env` (gitignored) and in Vercel project env vars. Never commit `.env`.

## Quick start (local)

```bash
npm install
cp .env.example .env

# 1. Get a testnet account (1000 HBAR pre-funded)
#    https://portal.hedera.com → Testnet → Create Account
#    Paste the Account ID + DER private key into HEDERA_OPERATOR_ID +
#    HEDERA_OPERATOR_KEY in .env.
#
#    Optional: `npm run genkey` generates a fresh ED25519 keypair locally if
#    you want to bring your own key into the portal.

# 2. Create a dedicated HCS topic for the protocol
npm run create-topic
#    Paste the printed HEDERA_TOPIC_ID into .env.

# 3. Sanity check
npm run check    # prints account, balance, topic info
npm run selftx   # submits a real Testnet HCS message, prints HashScan URL

# 4. End-to-end live verification (5 green ticks)
npm run verify   # mints, polls Mirror Node, revokes, polls again — all real

# 5. Run the API
npm run api      # http://localhost:3010
```

Smoke-test the live HTTP endpoints:

```bash
chmod +x scripts/smoke-live.sh
./scripts/smoke-live.sh http://localhost:3010
```

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health`          | Service heartbeat |
| GET  | `/api/validators`      | List validator set |
| GET  | `/api/config-check`    | Validate operator + key + topic + Mirror Node reachability |
| GET  | `/api/funding-status`  | Account balance check (Hedera has no faucet — points to portal) |
| POST | `/api/score`           | Run validators only (no anchor) |
| POST | `/api/evaluate`        | Run validators + anchor verdict on Hedera Testnet (HCS) |
| GET/POST | `/api/x402/evaluate` | x402-paid evaluation: HTTP 402 challenge (USDC + HBAR schemes) → verify + settle via Hedera Official Facilitator → run consensus → anchor on HCS |
| GET  | `/api/stablecoin-info` | Live HTS metadata for every stablecoin Verun accepts (Mirror Node — Stablecoin Studio compatible) |
| POST | `/api/mint-sbt`        | Issue protocol-custodial SBT credential (HCS `vtrust-mint:` message) |
| POST | `/api/revoke-sbt`      | Kill-switch: revoke an SBT credential (HCS `vtrust-revoke:` message) |
| GET  | `/api/sbt-status`      | Read latest credential state for one agent (Mirror Node) |
| GET  | `/api/sbt-list`        | List all currently-credentialed agents (Mirror Node) |

## Architecture

| Verun primitive                     | Hedera mapping                                                       |
|-------------------------------------|----------------------------------------------------------------------|
| Network adapter                     | Hedera SDK `Client.forTestnet()` + Mirror Node REST API              |
| Account funding                     | Hedera Portal Faucet (testnet ships with 1000 HBAR per account)      |
| Verdict anchor                      | `TopicMessageSubmitTransaction` to the protocol HCS topic            |
| SBT registry (write)                | HCS topic message stream (`vtrust-mint:` / `vtrust-revoke:` prefixes) |
| SBT registry (read)                 | Mirror Node `GET /api/v1/topics/{topicId}/messages` + prefix parsing |
| Kill-switch                         | `vtrust-revoke:` HCS message — latest event per `agentId` wins      |
| x402 settlement                     | Hedera Official x402 Facilitator (verify + settle USDC / HBAR)       |
| Stablecoin info                     | Mirror Node `/api/v1/tokens/{tokenId}` — Stablecoin Studio compatible|

The SBT registry is a single dedicated HCS topic. The protocol's operator key is the topic's submit key, so only the protocol can write; anyone can read. Latest event per `agentId` (newest by `consensus_timestamp`) is the current state. Verifiable directly from the Hedera Mirror Node — no Verun API required.

> **Upgrade path:** drop in HTS `NonFungibleToken` mints per agent (with `freezeKey` for revoke) behind the same `/api/{mint,revoke,status,list}-sbt` surface when needed for production. The HCS topic stays as the audit channel.

## SBT scaling tradeoff (honest grant note)

The MVP's SBT model — HCS messages on a protocol topic, scanned via Mirror Node REST — is **deliberately the simplest pattern that preserves the "anyone can verify on-chain, no Verun API required" property**. Honest constraints:

| Property | Current MVP | Implication |
|---|---|---|
| Lookup complexity | `O(n)` over recent topic messages | `/api/sbt-status` and `/api/sbt-list` walk topic history each call. |
| Scan window | `SBT_SCAN_LIMIT` env (default 200) | A credential minted >200 events ago will appear as "not credentialed" if the cap is 200. |
| Mirror Node page size | 100 messages per request | Higher SCAN_LIMIT triggers paginated calls via `links.next`. |
| Per-call cost | 1 Mirror Node REST request per page (free) | Public Mirror Node is free for read but has per-IP rate limits. Production should self-host or use a paid Mirror Node provider. |
| Cache | None | Every status request hits Mirror Node. A 30-second LRU on `agentId → state` would absorb most demo load. |
| Eventual consistency | ~3–6 s after `submitMessage` returns | A status check immediately after mint will show `credentialed=false` for a few seconds; the verify and demo scripts poll/sleep to compensate. |
| Per-message cost | $0.0001 USD (fixed by Hedera fee schedule) | A credential lifecycle (mint + revoke) is ~$0.0002 lifetime, paid in HBAR-equivalent at the time of submission. |
| Message size | ≤ 1024 bytes per HCS message | We use ~80 bytes per `vtrust-*` message — plenty of headroom for future fields. |

**What the production version looks like.** Three options, ordered by lift:

1. **Add an indexer.** Subscribe to the topic over gRPC (`SubscribeQuery`), build an in-memory `agentId → latest_event` map, persist to Postgres / Redis. Lookup becomes `O(1)`. The on-chain HCS messages stay the source of truth — anyone can rebuild the index from any Mirror Node.
2. **Switch to HTS NFT-per-agent.** Each agent gets a dedicated HTS Non-Fungible Token; the protocol holds the `supplyKey` and `freezeKey`. Status becomes "is the issuer's HTS account frozen on this serial?" — a single Mirror Node `GET /api/v1/tokens/{tokenId}/nfts/{serial}` call. Revoke = burn or freeze. Scales to millions of credentials, but loses the single-topic-as-registry simplicity.
3. **Custom HSCS smart contract.** A small Solidity contract on Hedera EVM with a per-agent storage slot `(tier, score, ts, revoked_at)`. `O(1)` lookup, fully on-chain state, no indexer needed. This is the model regulators will eventually want for a MiCA audit. Cost: ~1 week to build + audit.

The `/api/{mint,revoke,status,list}-sbt` surface is shaped to be invariant under all three migrations — only `src/sbt.js` swaps out.

## Environment variables

See `.env.example`. Required: `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_TOPIC_ID`. Optional: `HEDERA_NETWORK`, `MIRROR_NODE_URL`, `SBT_SCAN_LIMIT`, `PORT`.

## Deploy

See `DEPLOY.md` for the GitHub + Vercel walkthrough.

## License

MIT — © 2026 BCP Partners GmbH
