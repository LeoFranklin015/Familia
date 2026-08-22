#!/usr/bin/env bash
# End-to-end run of the five demo beats against a running kin server (:8787)
# and Sepolia. Uses the passphrase vault path (curl has no WebAuthn).
set -euo pipefail
BASE=${BASE:-http://localhost:8787}
TMP=$(mktemp -d)
PJ="$TMP/parent.jar"; MJ="$TMP/member.jar"
step() { printf '\n\033[1m— %s —\033[0m\n' "$*"; }
post() { local jar=$1 path=$2 body=$3; curl -sf -b "$jar" -c "$jar" -H 'content-type: application/json' -d "$body" "$BASE$path"; }
get() { local jar=$1 path=$2; curl -sf -b "$jar" "$BASE$path"; }
jqr() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)"; }

step "0. create family + parent joins (passphrase vault)"
TOKEN=$(post "$PJ" /api/family '{"name":"The Demo Family","parentName":"Alex"}' | jqr "['joinPath'].split('/')[-1]")
PARENT=$(post "$PJ" "/api/join/$TOKEN" '{"passphrase":"parent-passphrase-demo"}')
echo "parent: $PARENT"

step "1. parent deposits 500 USD₮ into the savings position (faucet mint + approve + deposit, one sponsored UserOp)"
post "$PJ" /api/deposit '{"amount":"500"}' | jqr "['txHash']"

step "2. member joins by link — no funding, no seed phrase shown"
MTOKEN=$(post "$PJ" /api/invites '{"name":"Sam"}' | jqr "['joinPath'].split('/')[-1]")
MEMBER=$(post "$MJ" "/api/join/$MTOKEN" '{"passphrase":"member-passphrase-demo"}')
echo "member: $MEMBER"

step "2b. parent grants Sam a scope: 50 per tx, 120 per week"
MID=$(get "$PJ" /api/state | jqr "['members'][0]['id']")
post "$PJ" "/api/members/$MID/grant" '{"perTx":"50","period":"120","periodLengthDays":7}' | jqr "['scopeId']"
get "$MJ" /api/me | jqr "['spendable']"

step "3. member spends 8 USD₮ at Corner Store — redeemed from savings, straight to merchant, zero gas"
post "$MJ" /api/spend '{"to":"0x1111000000000000000000000000000000001111","amount":"8"}'

step "4. member tries 200 — over cap: becomes an ask, parent approves, it clears"
post "$MJ" /api/spend '{"to":"0x2222000000000000000000000000000000002222","amount":"200"}'
RID=$(get "$PJ" /api/state | jqr "['pendingRequests'][0]['requestId']")
post "$PJ" "/api/requests/$RID/approve" '{}' | jqr "['txHash']"

step "5. parent revokes — next attempt is refused"
post "$PJ" "/api/members/$MID/revoke" '{}' | jqr "['txHash']"
echo "member tries to spend 5 after revoke:"
curl -s -b "$MJ" -H 'content-type: application/json' -d '{"to":"0x1111000000000000000000000000000000001111","amount":"5"}' "$BASE/api/spend"
echo
echo "and again with force=true, skipping every local check so the CONTRACT is what refuses:"
curl -s -b "$MJ" -H 'content-type: application/json' -d '{"to":"0x1111000000000000000000000000000000001111","amount":"5","force":true}' "$BASE/api/spend"

step "final state"
get "$PJ" /api/state | python3 -m json.tool | head -30
echo "ALL FIVE BEATS DONE"
