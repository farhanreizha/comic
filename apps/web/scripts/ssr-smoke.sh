#!/usr/bin/env bash
# SSR smoke: the pages must be server-rendered, not client shells.
# Fetches a real comic + chapter from the API, then asserts the *content*
# (title, page image URLs, chapter header) is in the served HTML — and that
# the reader does NOT ship the loading placeholder as its body.
# Usage: WEB_URL=http://localhost:5173 [API_URL=http://localhost:3000] ./scripts/ssr-smoke.sh
set -u
WEB="${WEB_URL:-http://localhost:5173}"
API="${API_URL:-http://localhost:3000}"
PASS=0
FAIL=0

fail() { echo "FAIL $*"; FAIL=$((FAIL + 1)); }
pass() { echo "ok   $*"; PASS=$((PASS + 1)); }

# fetch <url> -> sets BODY, CODE
fetch() {
	local out
	out=$(curl -s -w $'\n%{http_code}' "$1") || out=$'\n000'
	CODE="${out##*$'\n'}"
	BODY="${out%$'\n'*}"
}

# assert_contains <name> <url> <want_status> <needle>
assert_contains() {
	local name="$1" url="$2" want="$3" needle="$4"
	fetch "$url"
	if [ "$CODE" != "$want" ]; then
		fail "$name $url -> HTTP $CODE (want $want)"; return
	fi
	local hit
	hit=$(printf '%s' "$BODY" | grep -oF -- "$needle" | head -1)
	if [ -z "$hit" ]; then
		fail "$name $url -> HTML lacks '$needle' (${#BODY} bytes)"; return
	fi
	pass "$name $url ($CODE, ${#BODY}B, grep '$hit')"
}

# assert_absent <name> <url> <needle>
assert_absent() {
	local name="$1" url="$2" needle="$3"
	fetch "$url"
	if printf '%s' "$BODY" | grep -qF -- "$needle"; then
		fail "$name $url -> HTML still contains '$needle'"; return
	fi
	pass "$name $url (absent: '$needle', ${#BODY}B)"
}

# ---- discover a real comic + chapter from the read API -----------------------
BR=$(curl -s -X POST "$API/rpc/reading/browse" -H 'content-type: application/json' -d '{"json":{"limit":5}}')
SLUG=$(printf '%s' "$BR" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')
TITLE=$(printf '%s' "$BR" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')
if [ -z "$SLUG" ] || [ -z "$TITLE" ]; then
	fail "API discovery: no comic in browse response — cannot verify content asserts"
	echo "SSR SMOKE FAILED ($PASS passed, $FAIL failed)"; exit 1
fi
echo "discovered: slug=$SLUG title=$TITLE"
CH=$(curl -s -X POST "$API/rpc/reading/read" -H 'content-type: application/json' \
	-d "{\"json\":{\"kind\":\"comic\",\"ref\":{\"slug\":\"$SLUG\"}}}")
CHAPTER=$(printf '%s' "$CH" | sed -n 's/.*"chapters":\[{"id":"\([^"]*\)".*/\1/p')
CHTITLE=$(printf '%s' "$CH" | sed -n 's/.*"chapters":\[{"id":"[^"]*","comicId":"[^"]*","ordinal":[0-9]*,"title":"\([^"]*\)".*/\1/p')
echo "discovered: chapter=$CHAPTER title=${CHTITLE:-<empty>}"

# ---- browse: the comic title must be in the server HTML ----------------------
QURL=$(printf '%s' "$TITLE" | sed 's/ /%20/g')
assert_contains "browse /"        "$WEB/"                  200 "$TITLE"
assert_contains "browse filtered" "$WEB/?q=$QURL"          200 "$TITLE"

# ---- detail: title + chapter list server-rendered ----------------------------
assert_contains "detail /comic"   "$WEB/comic/$SLUG"   200 "$TITLE"
assert_contains "detail chapters" "$WEB/comic/$SLUG"   200 '/read/'

# ---- reader: header + first page <img>, no loading placeholder --------------
if [ -n "$CHAPTER" ]; then
	assert_contains "reader title"  "$WEB/read/$CHAPTER" 200 "${CHTITLE:-Chapter}"
	assert_contains "reader images" "$WEB/read/$CHAPTER" 200 "/pages/"
	assert_absent   "reader shell"  "$WEB/read/$CHAPTER" 'Memuat…'
else
	fail "no chapter discovered — reader asserts skipped"
fi

# ---- library: signed-out prompt (no cookie sent, so this is the real state) --
LIB=$(curl -s "$WEB/library")
if printf '%s' "$LIB" | grep -q 'Masuk untuk punya perpustakaan\|Sign in to keep a library'; then
	HIT=$(printf '%s' "$LIB" | grep -o 'Masuk untuk punya perpustakaan\.\|Sign in to keep a library\.' | head -1)
	pass "library /library signed-out prompt ($(printf '%s' "$LIB" | wc -c)B, grep '$HIT')"
elif printf '%s' "$LIB" | grep -q 'Perpustakaan'; then
	pass "library /library shelf rendered ($(printf '%s' "$LIB" | wc -c)B)"
else
	fail "library /library -> neither signed-out prompt nor shelf in HTML"
fi

# ---- static chrome + 404 ------------------------------------------------------
assert_contains "login /login"    "$WEB/login"           200 "Masuk"
assert_contains "nav /"           "$WEB/"                200 "Jelajah"
fetch "$WEB/no-such-page-here"
if [ "$CODE" = "404" ]; then pass "404 unknown route ($CODE)"; else fail "404 unknown route -> $CODE"; fi

echo
echo "SSR SMOKE: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
echo "SSR SMOKE PASSED"
