#!/usr/bin/env bash
# Smoke test against a running API. Needs curl and jq.
#   scripts/smoke.sh                     reads every view, checks auth, validation and the sanctions gate
#   FULL=1 scripts/smoke.sh              also runs Alice's loan on the ledger: apply, approve, pay one installment
# Env: API (default http://localhost:3001), BROKER_KEY (else read from apps/api/.env).
# The sanctions check leaves one denied application behind; the broker's demo reset clears it.
set -uo pipefail

API="${API:-http://localhost:3001}"
if [ -z "${BROKER_KEY:-}" ] && [ -f apps/api/.env ]; then
  BROKER_KEY="$(grep -E '^BROKER_KEY=' apps/api/.env | cut -d= -f2-)"
fi
KEY="${BROKER_KEY:-}"
fails=0
BODY=""
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# check <label> <expected status> <method> <path> [json body] [nokey]
check() {
  local label="$1" want="$2" method="$3" path="$4" data="${5:-}" nokey="${6:-}"
  local args=(-s -m 60 -o "$OUT" -w "%{http_code}" -X "$method" -H "content-type: application/json")
  [ -z "$nokey" ] && [ -n "$KEY" ] && args+=(-H "x-broker-key: $KEY")
  [ -n "$data" ] && args+=(-d "$data")
  local got
  got="$(curl "${args[@]}" "$API$path")"
  BODY="$(cat "$OUT")"
  if [ "$got" = "$want" ]; then
    printf "  ok    %-38s %s\n" "$label" "$got"
  else
    printf "  FAIL  %-38s got %s, want %s: %s\n" "$label" "$got" "$want" "$(echo "$BODY" | head -c 200)"
    fails=$((fails + 1))
  fi
}
# expect <label> <jq filter that must be true>
expect() {
  if echo "$BODY" | jq -e "$2" >/dev/null 2>&1; then printf "  ok    %s\n" "$1"; else printf "  FAIL  %s\n" "$1"; fails=$((fails + 1)); fi
}

echo "Smoke test: $API"
check "health" 200 GET /api/health
expect "health says ok" '.ok == true'
check "wallets" 200 GET /api/wallets
ALICE="$(echo "$BODY" | jq -r '.[] | select(.role=="alice") | .address')"
SANCTIONED="$(echo "$BODY" | jq -r '.[] | select(.role=="borrower") | .address')"
[ -n "$ALICE" ] && [ -n "$SANCTIONED" ] || { echo "  FAIL  wallets are missing alice or borrower"; exit 1; }

check "vault" 200 GET "/api/vault?address=$ALICE"
check "applications" 200 GET /api/applications
check "loans" 200 GET /api/loans
check "alerts" 200 GET /api/alerts
check "agent" 200 GET /api/agent
check "verify (public)" 200 GET "/api/verify/$ALICE" "" nokey
check "score token (public)" 200 GET "/api/score-tokens/$ALICE" "" nokey

echo "Auth and validation"
check "broker without key" 401 GET /api/broker "" nokey
check "broker with key" 200 GET /api/broker
check "revenue" 200 GET /api/broker/revenue
check "audit" 200 GET /api/broker/audit
check "bad application" 400 POST /api/applications '{"borrowerAddress":"x","amount":"abc","paymentTotal":99}'
expect "400 names the bad fields" '.fields | has("borrowerAddress")'

echo "Sanctions gate"
check "sanctioned borrower applies" 201 POST /api/applications \
  "{\"borrowerAddress\":\"$SANCTIONED\",\"amount\":\"500\",\"paymentTotal\":3,\"creditConsent\":true}"
expect "blocked before scoring" '.status == "denied" and .decision.sanctions.blocked == true'

if [ "${FULL:-}" = "1" ]; then
  echo "Loan on the ledger (Alice)"
  check "Alice applies" 201 POST /api/applications \
    "{\"borrowerAddress\":\"$ALICE\",\"amount\":\"500\",\"paymentTotal\":3,\"creditConsent\":true}"
  ID="$(echo "$BODY" | jq -r '.id // empty')"
  if [ -n "$ID" ]; then
    expect "Alice is approved for review" '.status == "pending_review"'
    check "broker approves" 200 POST "/api/applications/$ID/approve"
    expect "loan is active" '.status == "active" and (.loanId | length) > 0'
    LOAN="$(echo "$BODY" | jq -r '.loanId // empty')"
    if [ -n "$LOAN" ]; then
      check "Alice pays one installment" 200 POST "/api/loans/$LOAN/pay-due"
      expect "payment has a tx" '.tx.result == "tesSUCCESS"'
    fi
  else
    echo "  (skipped approve and pay: Alice already has an open application, or the agent is paused)"
  fi
fi

if [ "$fails" -eq 0 ]; then echo "All checks passed"; else echo "$fails check(s) failed"; exit 1; fi
