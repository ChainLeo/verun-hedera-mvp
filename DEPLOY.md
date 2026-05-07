# Deploy

End-to-end: get a Hedera Testnet account → create a topic → push to GitHub → ship to Vercel.

## 1. Get a testnet account

1. Visit [portal.hedera.com](https://portal.hedera.com) and sign in.
2. Pick **Testnet** → **Create Account**. The portal generates an ED25519 keypair and pre-funds the account with **1000 HBAR**.
3. Copy:
   - `HEDERA_OPERATOR_ID` — looks like `0.0.123456`
   - `HEDERA_OPERATOR_KEY` — DER-encoded private key, looks like `302e0201...`

## 2. Local setup + create the topic

```bash
git clone git@github.com:Fahad00674/verun-hedera-mvp.git
cd verun-hedera-mvp
npm install
cp .env.example .env
# edit .env with HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY

# Create the dedicated HCS topic (operator becomes sole submitter)
npm run create-topic
# → Paste the printed HEDERA_TOPIC_ID into .env

# Sanity check + 5 green ticks against real Testnet
npm run check
npm run verify
```

## 3. Push to GitHub

```bash
gh auth status   # already logged in per project setup

gh repo create Fahad00674/verun-hedera-mvp --public --source=. \
  --description "Verun Hedera MVP — AI Agent Trust Layer with HCS anchoring" \
  --remote origin

git add .
git commit -m "Initial commit: Verun Hedera MVP"
git push -u origin main
```

## 4. Deploy to Vercel

```bash
vercel link        # accept defaults, or pass --project verun-hedera-mvp
vercel --prod
```

Then in **Vercel → Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `HEDERA_OPERATOR_ID` | `0.0.<your account id>` |
| `HEDERA_OPERATOR_KEY` | `302e0201...` (DER private key) |
| `HEDERA_TOPIC_ID` | `0.0.<topic id from step 2>` |
| `HEDERA_NETWORK` | `testnet` |
| `MIRROR_NODE_URL` | `https://testnet.mirrornode.hedera.com` |
| `SBT_SCAN_LIMIT` | `200` |

Set them for **Production**, **Preview**, and **Development**, then redeploy:

```bash
vercel --prod
```

## 5. Smoke-test the live deployment

```bash
BASE=https://hedera.erster.fund
curl -s "$BASE/api/health" | jq
curl -s "$BASE/api/config-check" | jq '.checks'
curl -s "$BASE/api/validators" | jq '.total'

# Full SBT lifecycle (mint → verify → revoke → re-verify)
chmod +x scripts/sbt-demo.sh
BASE="$BASE" ./scripts/sbt-demo.sh agt_grant_demo 720
```

## Custom domain (optional)

```bash
vercel domains add verun.bcpp.io
# In your DNS provider, CNAME verun.bcpp.io → cname.vercel-dns.com
```

## Rotation / hygiene

- Never commit `.env`. The `.gitignore` is set up to ignore it.
- The DER private key shown by `npm run genkey` is printed to stdout. Treat it as testnet-only. **Rotate before mainnet.**
- Vercel env vars are encrypted at rest but visible to anyone with project access — restrict access via Vercel teams.
- The `HEDERA_TOPIC_ID` topic uses the operator as the sole submit key. If you ever rotate the operator key, you'll need to update the topic's submit key too via `TopicUpdateTransaction`.
