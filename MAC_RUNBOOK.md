# Mac runbook — local Hedera Testnet verification

Step-by-step commands you'll run on your Mac, with expected output at each stage and a failure-mode table at the end. Operator key never leaves your laptop.

## 0. Prereqs (already in place per the brief)
- Node.js 18+ and npm
- gh CLI authed
- vercel CLI authed
- macOS shell (zsh or bash)

## 1. Unpack and install

```bash
cd ~/Downloads
tar -xzf verun-hedera-mvp.tar.gz
cd verun-hedera-mvp
npm install
```

**Expected:** ~150 packages installed, no high-severity audit warnings. `node_modules/@hashgraph/sdk` exists.

## 2. Get a testnet operator account (manual, in your browser)

1. Open <https://portal.hedera.com> and sign in.
2. Click **Testnet** → **Create Account**.
3. The portal generates an ED25519 keypair AND assigns a `0.0.X` Account ID, pre-funded with **1000 HBAR**.
4. Copy three values into a scratch buffer (do **not** paste them anywhere except your local `.env`):
   - **Account ID** — looks like `0.0.123456`
   - **DER Encoded Private Key** — looks like `302e0201...` (~96 hex chars after the prefix)
   - (Optionally) **DER Encoded Public Key** — for your records only

> The portal also offers an "ECDSA" key type. You can use either; this code accepts both. ED25519 is the default and the recommended choice for HCS.

## 3. Set up `.env`

```bash
cp .env.example .env
```

Open `.env` in your editor (`code .env` or `vim .env`) and replace:

```
HEDERA_OPERATOR_ID=0.0.PASTE_ACCOUNT_ID_HERE
HEDERA_OPERATOR_KEY=302e0201_PASTE_DER_PRIVATE_KEY_HERE
HEDERA_TOPIC_ID=0.0.PASTE_TOPIC_ID_HERE     # leave for now
```

with the real Account ID and DER private key. Leave `HEDERA_TOPIC_ID` as the placeholder — the next step creates and prints it.

`.env` is gitignored. Don't commit it.

## 4. Create the dedicated HCS topic

```bash
npm run create-topic
```

**Expected output (real values yours, not these):**
```
Creating HCS topic on hedera-testnet…
────────────────────────────────────────────────────────────
 HCS topic created
────────────────────────────────────────────────────────────
 HEDERA_TOPIC_ID = 0.0.5678901
 transaction id  : 0.0.123456@1715000000.123456789
 explorer        : https://hashscan.io/testnet/topic/0.0.5678901
────────────────────────────────────────────────────────────
```

Paste the printed `HEDERA_TOPIC_ID` value into `.env`, replacing `0.0.PASTE_TOPIC_ID_HERE`.

The topic is created with the operator key as the **submit key**, so only your operator can publish `vtrust-*` messages. Anyone can read.

## 5. Sanity check

```bash
npm run check
```

**Expected:**
```
network        : hedera-testnet
account_id     : 0.0.123456
balance_hbar   : 999.99...    (something close to 1000 if fresh)
balance_tinybar: 99999...
explorer       : https://hashscan.io/testnet/account/0.0.123456
topic_id       : 0.0.5678901
topic_memo     : verun-mvp:vtrust-registry
topic_deleted  : false
topic_explorer : https://hashscan.io/testnet/topic/0.0.5678901
```

Then a single self-test message:

```bash
npm run selftx
```

**Expected:** prints `sequence_number: 1`, a `transaction_id`, and a HashScan URL. Click it — you should see your message body in HashScan.

## 6. The 5 green ticks

```bash
npm run verify
```

**Expected output (each tick is a real on-chain operation):**

```
┌─ Verun Hedera MVP — Live Verification (5 ticks) ─────────────┐
│ Network: hedera-testnet    Mirror Node: https://testnet.mirrornode.hedera.com
└──────────────────────────────────────────────────────────────┘

[1/5] Checking operator account on real Testnet…
      ✓ operator    : 0.0.123456
        balance     : 999.96 HBAR
        explorer    : https://hashscan.io/testnet/account/0.0.123456

[2/5] Verifying HCS topic via Mirror Node REST…
      ✓ topic_id    : 0.0.5678901
        memo        : verun-mvp:vtrust-registry
        admin_key   : (unset)
        submit_key  : (set)
        explorer    : https://hashscan.io/testnet/topic/0.0.5678901

[3/5] Minting VTRUST SBT for agent verify_<timestamp> (score 720)…
      ✓ tier        : MED
        score       : 720
        sequence_no : 3
        tx_id       : 0.0.123456@1715000010.111222333
        msg_explorer: https://hashscan.io/testnet/topic/0.0.5678901/message/3

[4/5] Polling Mirror Node until mint message is ingested…
      ✓ credentialed: true
        tier        : MED
        score       : 720
        ingestion   : 4500 ms (Mirror Node)
        verify_url  : https://hashscan.io/testnet/topic/0.0.5678901/message/3

[5/5] Revoking credential (kill-switch) and re-verifying…
        revoke seq  : 4
        revoke tx   : 0.0.123456@1715000020.444555666
        revoke url  : https://hashscan.io/testnet/topic/0.0.5678901/message/4
      ✓ credentialed: false (kill-switch confirmed)
        last_event  : revoke@seq 4
        ingestion   : 4200 ms (Mirror Node)

┌─ All five ticks green ────────────────────────────────────────┐
│ ✓ 1. Operator reachable and funded
│ ✓ 2. HCS topic exists, Mirror Node returns metadata
│ ✓ 3. Mint submitMessage confirmed (sequence 3)
│ ✓ 4. statusSBT confirms credentialed=true (tier MED)
│ ✓ 5. Revoke confirmed (sequence 4); statusSBT credentialed=false
└───────────────────────────────────────────────────────────────┘

        agent_id    : verify_<timestamp>
        topic       : https://hashscan.io/testnet/topic/0.0.5678901
```

## 7. Optional: run the API locally and exercise the demo

```bash
# In one terminal:
npm run api
# → verun-hedera-mvp API on :3010

# In another terminal:
chmod +x scripts/sbt-demo.sh
BASE=http://localhost:3010 ./scripts/sbt-demo.sh agt_local 720
```

Walks the full mint → public Mirror Node verify → revoke → re-verify flow against the local server.

## 8. Push to GitHub + deploy to Vercel

```bash
git init
git add .
git commit -m "Initial commit: Verun Hedera MVP"
gh repo create Fahad00674/verun-hedera-mvp --public --source=. \
  --description "Verun Hedera MVP — AI Agent Trust Layer with HCS anchoring" \
  --remote origin --push

vercel link            # accept defaults or specify --project verun-hedera-mvp
```

Then in **Vercel → Settings → Environment Variables**, add the same five vars from your local `.env` (production + preview + development), and:

```bash
vercel --prod
```

Smoke the deployed URL:

```bash
BASE=https://hedera.erster.fund
curl -s "$BASE/api/health" | jq
curl -s "$BASE/api/config-check" | jq '.checks.operator_id_valid, .checks.topic_id_valid, .checks.mirror_reachable'
BASE="$BASE" ./scripts/sbt-demo.sh agt_prod_demo 720
```

## Failure-mode table

| Symptom | Cause | Fix |
|---|---|---|
| `HEDERA_OPERATOR_ID env var missing` | `.env` not loaded or wrong dir | Run from the project root; `cat .env \| grep HEDERA_OPERATOR_ID` to confirm. |
| `HEDERA_OPERATOR_KEY could not be decoded (expected DER 302e02...)` | You pasted the public key, hex-only key, or there's whitespace | Use the **DER Encoded Private Key** field from the portal. Should be ~96+ hex chars and start with `302e0201`. |
| `HEDERA_OPERATOR_ID invalid (expected 0.0.X form)` | You pasted an EVM address (0x...) by mistake | Use the `0.0.X` Account ID, not the EVM address. |
| `INSUFFICIENT_PAYER_BALANCE` on submitMessage | Operator < 1 HBAR | Top up at <https://portal.hedera.com>; refresh balance with `npm run check`. |
| `topic_id_present=false` from /api/config-check | `HEDERA_TOPIC_ID` blank or still `0.0.PASTE_TOPIC_ID_HERE` | Re-run `npm run create-topic` and paste the new ID. |
| `Mirror Node 404` for topic | You pasted a topic ID created on a different network | Confirm `HEDERA_NETWORK=testnet` matches where the topic was created. Recreate if mismatched. |
| `Mirror Node 429` (rate limit) | Public Testnet Mirror Node throttled your IP | Wait ~30 seconds; or use a paid Mirror Node provider (Hedera Hashio, etc.) and set `MIRROR_NODE_URL`. |
| `verify` fails on tick 4 ("mint ingestion timeout") | Mirror Node ingestion took >30s | Re-run `npm run verify` — Testnet ingestion is usually 3–6s but can spike. The mint *did* happen on chain; check HashScan. |
| `verify` fails on tick 5 ("revoke ingestion timeout") | Same as above for revoke | Same fix; raise `max` in `pollUntil` to 60000 in `scripts/verify.js` if persistent. |
| `INVALID_SIGNATURE` on submitMessage | The `HEDERA_OPERATOR_KEY` doesn't match the topic's submit key | This means a different key was used to create the topic. Either use that original key, or run `npm run create-topic` again with the current key. |
| HashScan link 404s | Mirror Node hasn't ingested yet | Wait 5–10s and refresh — Testnet HashScan reads from Mirror Node. |
| Vercel function timeouts on `/api/sbt-list` for large registries | `SBT_SCAN_LIMIT` too high for the 30s function ceiling | Lower `SBT_SCAN_LIMIT` to 100, or move to a self-hosted indexer (see README scaling tradeoff section). |
| `EHEDERA_NETWORK` undefined | Old @hashgraph/sdk version | `npm install @hashgraph/sdk@^2.55.0` and retry. |

## What you'll paste back to me (safe outputs only)

After you run the verify locally:

- The `HEDERA_TOPIC_ID` (it's a public identifier, fine to share)
- The five tick lines from the summary block
- 2–3 HashScan URLs (mint message, revoke message, topic page)
- Mirror Node ingestion timings
- Any failure-mode you hit and the fix that worked

**Do not paste:** operator account ID *with* the private key together (account ID alone is fine), the DER private key, the contents of `.env`, or any seed phrase the portal shows.
