#!/usr/bin/env bash
# SSR smoke: curl every route on a running web server and assert status +
# a distinctive string in the HTML. Usage: WEB_URL=http://localhost:5173 \
# [API_URL=http://localhost:3000] ./scripts/ssr-smoke.sh
set -u
WEB="${WEB_URL:-http://localhost:5173}"
API="${API_URL:-http://localhost:3000}"
FAIL=0

assert() { # name url want_status want_string
	local name="$1" url="$2" want="$3" wantstr="$4"
	local body code
	body=$(curl -s -w '\n%{http_code}' "$url")
	code="${body##*$'\n'}"
	body="${body%$'\n'*}"
	if [ "$code" != "$want" ]; then
		echo "FAIL $name $url -> HTTP $code (want $want)"; FAIL=1; return
	fi
	if ! printf '%s' "$body" | grep -qF -- "$wantstr"; then
		echo "FAIL $name $url -> missing '$wantstr'"; FAIL=1; return
	fi
	echo "ok   $name $url ($code, '$wantstr')"
}

# Discover a real comic/chapter from the browse API so detail/reader can be hit.
SLUG=""
CHAPTER=""
if [ -x "$(command -v jq)" ] || true; then
	BR=$(curl -s -X POST "$API/rpc/reading/browse" -H 'content-type: application/json' -d '{"json":{}}')
	SLUG=$(printf '%s' "$BR" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')
	TITLE=$(printf '%s' "$BR" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p' | head -1)
	CH=$(curl -s -X POST "$API/rpc/reading/read" -H 'content-type: application/json' \
		-d "{\"json\":{\"kind\":\"comic\",\"ref\":{\"slug\":\"$SLUG\"}}}")
	CHAPTER=$(printf '%s' "$CH" | sed -n 's/.*"chapters":\[{\"id":"\([^"]*\)".*/\1/p')
fi

assert "browse /"            "$WEB/"                        200 "Jelajah"
assert "detail /comic/slug"  "$WEB/comic/${SLUG:-nonexistent}" 200 "${SLUG:-nonexistent} — komik"
assert "reader /read/id"     "$WEB/read/${CHAPTER:-bogus}"    200 "Memuat"
assert "library /library"    "$WEB/library"                 200 "Perpustakaan"
assert "login /login"        "$WEB/login"                   200 "Masuk"
assert "404 unknown route"   "$WEB/no-such-page-here"       404 ""

if [ "$FAIL" -ne 0 ]; then
	echo "SSR SMOKE FAILED"; exit 1
fi
echo "SSR SMOKE PASSED"
