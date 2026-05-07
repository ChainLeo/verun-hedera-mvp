#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3010}"

echo "== Verun Hedera MVP live smoke =="
echo "Base: $BASE_URL"

echo
printf "[1/5] health ... "
curl -sf "$BASE_URL/api/health" >/tmp/verun_health.json
jq -r '.ok // .success // "unknown"' /tmp/verun_health.json

echo
printf "[2/5] validators ... "
curl -sf "$BASE_URL/api/validators" >/tmp/verun_validators.json
jq -r '.total' /tmp/verun_validators.json

echo
printf "[3/5] funding status ... "
curl -sf "$BASE_URL/api/funding-status" >/tmp/verun_funding.json
jq -r '.balance.hbar' /tmp/verun_funding.json

echo
printf "[4/5] config check ... "
curl -sf "$BASE_URL/api/config-check" >/tmp/verun_config.json
jq -r '.checks.operator_id_valid, .checks.operator_key_valid, .checks.topic_id_valid, .checks.mirror_reachable' /tmp/verun_config.json

echo
printf "[5/5] evaluate ... "
curl -sf -X POST "$BASE_URL/api/evaluate" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agt_demo","score":820,"operation":"transfer"}' >/tmp/verun_eval.json
jq -r '.success' /tmp/verun_eval.json
jq -r '.verdict.consensus, .verdict.permitted' /tmp/verun_eval.json
jq -r '.anchor.txid // .anchor.status // "no_anchor"' /tmp/verun_eval.json
jq -r '.anchor.explorer // ""' /tmp/verun_eval.json

echo
echo "Smoke done."
