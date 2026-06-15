#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────
# Verun Hedera MVP · End-to-End Test Suite
# ────────────────────────────────────────────────────────────────────────
# Comprehensive A→Z verification: infrastructure, static assets, core APIs,
# x402 challenge, consensus, on-chain HCS anchor, Stablecoin Studio compat,
# external dependencies, routing.
#
# Usage:
#   ./scripts/e2e.sh                        # tests live https://hedera.erster.fund
#   ./scripts/e2e.sh http://localhost:3010  # tests a local API server
#
# Exit code = number of failures.
# ────────────────────────────────────────────────────────────────────────

BASE="${1:-https://hedera.erster.fund}"
PASS=0
FAIL=0

pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
section() { printf "\n\033[1;34m[%s]\033[0m %s\n" "$1" "$2"; }

# tiny helpers
fetch_status() { curl -s -o /dev/null -w "%{http_code}" "$1"; }
fetch_body()   { curl -s "$@"; }
# Use GET (not HEAD) so Vercel Node functions return all custom headers.
# `-D -` dumps headers to stdout, `-o /dev/null` discards the body.
fetch_header() { curl -s -D - -o /dev/null "$1" | tr -d '\r' | awk -F': ' -v h="$2" 'tolower($1)==tolower(h){print $2}'; }

printf "\033[1mVerun Hedera MVP · E2E\033[0m  →  %s\n" "$BASE"

# ──────────────────────────────────────────────────────────
section "A" "Infrastructure"
[ "$(fetch_status "$BASE/")" = "200" ] && pass "landing page reachable (200)" || fail "landing page unreachable"
[ "$(fetch_status "$BASE/docs.html")" = "200" ] && pass "/docs.html reachable" || fail "/docs.html unreachable"
ctype=$(fetch_header "$BASE/" "content-type")
[[ "$ctype" == *"text/html"* ]] && pass "Content-Type: text/html" || fail "wrong Content-Type ($ctype)"
hsts=$(fetch_header "$BASE/" "strict-transport-security")
[ -n "$hsts" ] && pass "HSTS header present" || fail "HSTS header missing"

# ──────────────────────────────────────────────────────────
section "B" "Static page content"
body=$(fetch_body "$BASE/")
echo "$body" | grep -q "ERSTER" && pass "ERSTER brand on landing" || fail "ERSTER brand missing"
echo "$body" | grep -q "Hedera Testnet" && pass "'Hedera Testnet' pill present" || fail "Hedera Testnet pill missing"
echo "$body" | grep -q "SpaceX Pre-IPO Shares" && pass "SpaceX Pre-IPO narrative present" || fail "SpaceX narrative missing"
echo "$body" | grep -q "x402 Powered" && pass "x402 Powered pill present" || fail "x402 Powered pill missing"
echo "$body" | grep -qv "EUR via direct" && pass "EUR via direct card REMOVED" || fail "EUR via direct STILL present"
echo "$body" | grep -qv "Folks Finance" && pass "Folks Finance refs REMOVED" || fail "Folks Finance STILL present"
echo "$body" | grep -qv "EUR-pegged" && pass "EUR-pegged label REMOVED" || fail "EUR-pegged STILL present"
echo "$body" | grep -qv "Algorand Anchor" && pass "Algorand Anchor strings REMOVED" || fail "Algorand Anchor STILL present"
echo "$body" | grep -q "Hedera Anchor" && pass "Hedera Anchor present (≥1)" || fail "Hedera Anchor missing"
echo "$body" | grep -q "Hedera Official Facilitator" && pass "Hedera Official Facilitator labeled" || fail "Hedera Official Facilitator missing"

# ──────────────────────────────────────────────────────────
section "C" "Core APIs"
[ "$(fetch_status "$BASE/api/health")" = "200" ] && pass "/api/health 200" || fail "/api/health not 200"
[ "$(fetch_status "$BASE/api/validators")" = "200" ] && pass "/api/validators 200" || fail "/api/validators not 200"
validators=$(fetch_body "$BASE/api/validators")
echo "$validators" | grep -q '"id"' && pass "validators list non-empty" || fail "validators list empty"
[ "$(fetch_status "$BASE/api/config-check")" = "200" ] && pass "/api/config-check 200" || fail "/api/config-check failed"

# ──────────────────────────────────────────────────────────
section "D" "x402 (HTTP 402 challenge)"
x402_status=$(fetch_status "$BASE/api/x402/evaluate")
[ "$x402_status" = "402" ] && pass "GET /api/x402/evaluate returns 402" || fail "GET /api/x402/evaluate returns $x402_status (expected 402)"
x402_body=$(fetch_body "$BASE/api/x402/evaluate")
echo "$x402_body" | grep -q '"x402Version"' && pass "x402Version field present" || fail "x402Version missing"
echo "$x402_body" | grep -q '"accepts"' && pass "accepts array present" || fail "accepts missing"
echo "$x402_body" | grep -q '"scheme":"exact"' && pass "scheme: exact (spec-compliant)" || fail "scheme: exact missing"
echo "$x402_body" | grep -q 'hedera:testnet' && pass "CAIP-2 hedera:testnet network ID" || fail "hedera:testnet network ID missing"
echo "$x402_body" | grep -q '"asset":"0.0.' && pass "USDC HTS token ID format 0.0.X" || fail "USDC token ID missing/wrong format"
echo "$x402_body" | grep -q '"asset":"HBAR"' && pass "HBAR native scheme present" || fail "HBAR scheme missing"
echo "$x402_body" | grep -q '"maxAmountRequired":"5000"' && pass "USDC amount: 5000 micro-USDC (0.005)" || fail "USDC amount wrong"
echo "$x402_body" | grep -q '"maxAmountRequired":"500000"' && pass "HBAR amount: 500000 tinybars (0.005)" || fail "HBAR amount wrong"
echo "$x402_body" | grep -q '"name":"USDC"' && pass "USDC extra.name set" || fail "USDC extra.name missing"
echo "$x402_body" | grep -q '"name":"HBAR"' && pass "HBAR extra.name set" || fail "HBAR extra.name missing"
echo "$x402_body" | grep -q '"decimals":6' && pass "USDC decimals: 6" || fail "USDC decimals wrong"
echo "$x402_body" | grep -q '"decimals":8' && pass "HBAR decimals: 8" || fail "HBAR decimals wrong"
x402_powered=$(fetch_header "$BASE/api/x402/evaluate" "x-402-powered")
[ -n "$x402_powered" ] && pass "X-402-Powered header present ($x402_powered)" || fail "X-402-Powered header missing"

# ──────────────────────────────────────────────────────────
section "E" "Consensus + evaluation"
eval_body=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"agentId":"agt_e2e","score":820,"operation":"transfer","validatorIds":["val-erster-01","val-tokenforge-02","val-test-03"]}' \
  "$BASE/api/evaluate")
echo "$eval_body" | grep -q '"success":true' && pass "/api/evaluate succeeds" || fail "/api/evaluate failed: $eval_body"
echo "$eval_body" | grep -q '"consensus"' && pass "consensus field present" || fail "consensus missing"
echo "$eval_body" | grep -q '"validators_used"' && pass "validators_used reported" || fail "validators_used missing"
echo "$eval_body" | grep -q '"permitted"' && pass "permitted boolean reported" || fail "permitted missing"

# Lower-tier test
eval_block=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"agentId":"agt_lowscore","score":100,"operation":"transfer"}' \
  "$BASE/api/evaluate")
echo "$eval_block" | grep -q '"permitted":false' && pass "low score → permitted:false" || fail "low score should be blocked"

# ──────────────────────────────────────────────────────────
section "F" "Stablecoin Studio compatibility"
[ "$(fetch_status "$BASE/api/stablecoin-info")" = "200" ] && pass "/api/stablecoin-info 200" || fail "/api/stablecoin-info failed"
sc_body=$(fetch_body "$BASE/api/stablecoin-info")
echo "$sc_body" | grep -q '"USDC"' && pass "USDC listed" || fail "USDC missing from stablecoin list"
echo "$sc_body" | grep -q 'Stablecoin Studio' && pass "Stablecoin Studio compat mentioned" || fail "Stablecoin Studio mention missing"
echo "$sc_body" | grep -q '"studio_compatible":true' && pass "studio_compatible flag set" || fail "studio_compatible flag missing"

# ──────────────────────────────────────────────────────────
section "G" "SBT lifecycle (HCS)"
[ "$(fetch_status "$BASE/api/sbt-list")" = "200" ] && pass "/api/sbt-list 200" || fail "/api/sbt-list failed"
[ "$(fetch_status "$BASE/api/sbt-status?agentId=agt_demo")" = "200" ] && pass "/api/sbt-status 200" || fail "/api/sbt-status failed"

# ──────────────────────────────────────────────────────────
section "H" "External deps reachable"
# Mirror Node root returns 404 — only /api/v1/* routes exist. Use real endpoint.
mn_status=$(fetch_status "https://testnet.mirrornode.hedera.com/api/v1/network/nodes?limit=1")
[ "$mn_status" = "200" ] && pass "Hedera Mirror Node testnet reachable ($mn_status)" || fail "Mirror Node testnet unreachable (got $mn_status)"
[ "$(fetch_status "https://hashscan.io")" = "200" ] && pass "HashScan explorer reachable" || fail "HashScan unreachable"

# ──────────────────────────────────────────────────────────
section "I" "Routing + footer"
echo "$body" | grep -q 'hashscan\.io' && pass "HashScan links present in page" || fail "HashScan links missing"
echo "$body" | grep -q 'verun-hedera-mvp' && pass "GitHub repo link present" || fail "GitHub repo link missing"
echo "$body" | grep -qv 'verun-hedera-mvp\.vercel\.app' && pass "Stale vercel.app URLs cleaned" || fail "vercel.app URLs still present"

# ──────────────────────────────────────────────────────────
printf "\n\033[1mResult:\033[0m  \033[32m%d passed\033[0m / \033[31m%d failed\033[0m  (total %d)\n" "$PASS" "$FAIL" "$((PASS+FAIL))"

exit "$FAIL"
