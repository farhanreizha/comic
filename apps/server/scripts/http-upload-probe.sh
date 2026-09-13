#!/usr/bin/env bash
# Proves the HTTP transport accepts chapter uploads past Bun's 128 MB default,
# and that our own over-limit rejection still arrives as a renderable JSON error.
#
# Why this exists: the e2e scripts drive `app.request()` in-process, which never
# touches Bun.serve, so they cannot see a transport-level body cap. A missing
# `maxRequestBodySize` on the server entry silently turns every upload over
# 128 MB into an empty 413 the UI cannot explain. This probe is the only check
# that covers that seam.
#
# Usage: start the server first, then run this.
#   cd apps/server && PORT=3999 bun src/index.ts
#   bash apps/server/scripts/http-upload-probe.sh http://127.0.0.1:3999
set -u

BASE="${1:-http://127.0.0.1:3000}"
WORK="$(mktemp -d)"
CK="$WORK/cookies.txt"
FAIL=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

request() { # $1 = payload file, prints "HTTP <code>|<body>"
	local code
	code=$(curl -s -o "$WORK/out" -w "%{http_code}" --max-time 600 \
		-b "$CK" -X POST "$BASE/publish/chapters" \
		-F "comicId=probe-nonexistent-comic" \
		-F "archive=@$1;filename=probe.cbz")
	printf '%s|%s' "$code" "$(head -c 200 "$WORK/out")"
}

echo "== readiness =="
up=0
for _ in $(seq 1 20); do
	if [ "$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/" || true)" = "200" ]; then
		up=1
		break
	fi
	sleep 1
done
if [ "$up" != "1" ]; then
	echo "FAIL: server not reachable at $BASE"
	exit 1
fi

echo "== session =="
curl -s -o "$WORK/signup" -c "$CK" -X POST "$BASE/api/auth/sign-up/email" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"probe-$(date +%s)@example.com\",\"password\":\"probe-password-123\",\"name\":\"Probe\"}"
if ! grep -q 'better-auth' "$CK" 2>/dev/null; then
	echo "FAIL: signup produced no session cookie"
	exit 1
fi
echo "session ok"

# 150 MB: under the module's 200 MB cap → must reach the handler and answer JSON.
dd if=/dev/zero of="$WORK/ok.bin" bs=1M count=150 status=none
# 205 MB: over the module cap, under the runtime cap → must answer JSON TOO_LARGE.
dd if=/dev/zero of="$WORK/over.bin" bs=1M count=205 status=none

for case in "150:$WORK/ok.bin:404:NOT_FOUND" "205:$WORK/over.bin:413:TOO_LARGE"; do
	mb="${case%%:*}"
	rest="${case#*:}"
	file="${rest%%:*}"
	rest="${rest#*:}"
	want_code="${rest%%:*}"
	want_body="${rest#*:}"
	result=$(request "$file")
	code="${result%%|*}"
	body="${result#*|}"
	echo "${mb}MB -> HTTP $code ${body}"
	if [ "$code" != "$want_code" ]; then
		echo "FAIL: ${mb}MB expected $want_code, got $code (empty 4xx body means the runtime cap is below the chapter cap)"
		FAIL=1
	fi
	if ! printf '%s' "$body" | grep -q "$want_body"; then
		echo "FAIL: ${mb}MB body did not contain $want_body"
		FAIL=1
	fi
done

if [ "$FAIL" != "0" ]; then
	echo "HTTP UPLOAD PROBE FAILED"
	exit 1
fi
echo "HTTP UPLOAD PROBE OK"
