#!/usr/bin/env bash
# SSR smoke for the comic platform.
#
# Asserts what the server actually renders: real content in the HTML (not a
# loading shell), the role-gated nav, and the gated pages. It signs a throwaway
# account up, promotes it to admin in the database, and re-checks — because a
# signed-out-only smoke is what let the previous empty-shell build pass.
#
# Usage:
#   WEB_URL=http://localhost:5199 API_URL=http://localhost:3000 \
#     DB_CONTAINER=comic-postgres bash scripts/ssr-smoke.sh
#
# A missing prerequisite is a FAILURE, never a skip.
set -u

WEB="${WEB_URL:-http://localhost:5173}"
API="${API_URL:-http://localhost:3000}"
DB_CONTAINER="${DB_CONTAINER:-comic-postgres}"
WORK="$(mktemp -d)"
CK="$WORK/reader.txt"
CK_ADMIN="$WORK/admin.txt"
PASS=0
FAIL=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); echo "ok   $1" >&2; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL $1" >&2; }

# body <url> [cookie-jar] -> HTML on stdout
body() {
	local url="$1"
	shift
	if [ "$#" -gt 0 ] && [ -n "${1:-}" ]; then
		curl -s -b "$1" "$url"
	else
		curl -s "$url"
	fi
}

# assert_has <name> <url> [cookie] -- <string>
assert_has() {
	local name="$1" url="$2" ck="${3:-}"
	shift 3 || true
	[ "${1:-}" = "--" ] && shift
	local want="$1"
	if [ -z "$want" ]; then
		fail "$name — the expected string is empty, which would make this check vacuous"
		return
	fi
	if body "$url" "$ck" | grep -qF -- "$want"; then
		pass "$name ('$want')"
	else
		fail "$name — HTML missing '$want'"
	fi
}

# assert_lacks <name> <url> [cookie] -- <string>
assert_lacks() {
	local name="$1" url="$2" ck="${3:-}"
	shift 3 || true
	[ "${1:-}" = "--" ] && shift
	local want="$1"
	if body "$url" "$ck" | grep -qF -- "$want"; then
		fail "$name — HTML unexpectedly contains '$want'"
	else
		pass "$name (absent '$want')"
	fi
}

# assert_status <name> <url> [cookie] -- <code>
assert_status() {
	local name="$1" url="$2" ck="${3:-}"
	shift 3 || true
	[ "${1:-}" = "--" ] && shift
	local want="$1" got
	if [ -n "$ck" ]; then
		got=$(curl -s -o /dev/null -w '%{http_code}' -b "$ck" "$url")
	else
		got=$(curl -s -o /dev/null -w '%{http_code}' "$url")
	fi
	if [ "$got" = "$want" ]; then pass "$name (HTTP $got)"; else fail "$name — HTTP $got, want $want"; fi
}

# assert_nav <name> <url> <cookie> -- <present...> ++ <absent...>
assert_nav() {
	local name="$1" url="$2" ck="$3"
	shift 3
	local html present=() absent=() mode=present
	for tok in "$@"; do
		if [ "$tok" = "++" ]; then mode=absent; continue; fi
		if [ "$mode" = present ]; then present+=("$tok"); else absent+=("$tok"); fi
	done
	html=$(body "$url" "$ck")
	local ok=1
	for p in "${present[@]}"; do
		printf '%s' "$html" | grep -qF -- "$p" || { fail "$name — nav missing $p"; ok=0; }
	done
	for a in "${absent[@]}"; do
		printf '%s' "$html" | grep -qF -- "$a" && { fail "$name — nav unexpectedly has $a"; ok=0; }
	done
	[ "$ok" = 1 ] && pass "$name"
}

signup() { # <jar> <label> -> prints email
	local jar="$1" label="$2" email
	email="smoke-$label-$(date +%s)@example.com"
	curl -s -o /dev/null -c "$jar" -X POST "$API/api/auth/sign-up/email" \
		-H 'content-type: application/json' \
		-d "{\"email\":\"$email\",\"password\":\"smoke-password-123\",\"name\":\"Smoke $label\"}"
	if grep -q 'better-auth' "$jar" 2>/dev/null; then
		pass "signup $label"
		printf '%s' "$email"
	else
		fail "signup $label — no session cookie (API reachable at $API?)"
		printf ''
	fi
}

promote_admin() { # <email>
	promote_role "$1" admin
}

promote_role() { # <email> <role>
	local out
	out=$(docker exec "$DB_CONTAINER" psql -U postgres -d comic -tAc \
		"update \"user\" set role='$2' where email='$1';" 2>&1)
	if [ "$(printf '%s' "$out" | tr -d '[:space:]')" = "UPDATE1" ]; then
		pass "promote to $2 in DB"
	else
		fail "promote to $2 — psql said: $out"
	fi
}

echo "== readiness =="
if ! curl -s -o /dev/null --max-time 10 "$WEB/"; then echo "FAIL: web server unreachable at $WEB"; exit 1; fi
if ! curl -s -o /dev/null --max-time 10 "$API/"; then echo "FAIL: api unreachable at $API"; exit 1; fi
command -v docker >/dev/null || { echo "FAIL: docker missing, cannot promote admin"; exit 1; }

echo "== discover a real comic and chapter =="
curl -s -X POST "$API/rpc/reading/browse" -H 'content-type: application/json' -d '{"json":{}}' > "$WORK/browse.json"
eval "$(python3 -c '
import json
d = json.load(open("'"$WORK"'/browse.json"))
it = d["json"]["items"][0]
print("SLUG=%s" % repr(it["slug"]))
print("TITLE=%s" % repr(it["title"]))
')"
CH=$(curl -s -X POST "$API/rpc/reading/read" -H 'content-type: application/json' \
	-d "{\"json\":{\"kind\":\"comic\",\"ref\":{\"slug\":\"$SLUG\"}}}" > "$WORK/read.json" &&
	python3 -c '
import json
d = json.load(open("'"$WORK"'/read.json"))
print(d["json"]["chapters"][0]["id"])
')
if [ -z "$SLUG" ] || [ -z "$CH" ]; then
	echo "FAIL: could not discover a comic/chapter from the API"; exit 1
fi
curl -s -X POST "$API/rpc/reading/read" -H 'content-type: application/json' \
	-d "{\"json\":{\"kind\":\"chapter\",\"chapterId\":\"$CH\"}}" > "$WORK/chapter.json"
CH_TITLE=$(python3 -c '
import json
d = json.load(open("'"$WORK"'/chapter.json"))
print(d["json"]["chapter"]["title"])
')
if [ -z "$CH_TITLE" ]; then
	echo "FAIL: could not read the chapter title from the API"; exit 1
fi
echo "comic=$SLUG chapter=$CH ($CH_TITLE)"

echo "== signed-out content =="
assert_has "browse renders a comic" "$WEB/" "" -- "$TITLE"
assert_has "browse renders the shell" "$WEB/" "" -- "Jelajah"
assert_has "detail renders title" "$WEB/comic/$SLUG" "" -- "$TITLE"
assert_has "detail renders chapter link" "$WEB/comic/$SLUG" "" -- "/read/"
assert_has "detail renders comment section" "$WEB/comic/$SLUG" "" -- "Komentar"
assert_has "detail offers sign-in for comments" "$WEB/comic/$SLUG" "" -- "Masuk untuk menulis komentar."
assert_has "detail offers sign-in for saving" "$WEB/comic/$SLUG" "" -- "Masuk untuk simpan ke perpustakaan."
assert_lacks "detail hides the save toggle signed-out" "$WEB/comic/$SLUG" "" -- ">Tersimpan<"
assert_has "reader renders the chapter" "$WEB/read/$CH" "" -- "$CH_TITLE"
assert_has "reader renders page images" "$WEB/read/$CH" "" -- "/pages/"
assert_lacks "reader is not a loading shell" "$WEB/read/$CH" "" -- "Memuat…"
assert_has "library prompts signed-out" "$WEB/library" "" -- "Masuk untuk punya perpustakaan."
assert_has "login page renders" "$WEB/login" "" -- "Masuk"
assert_status "unknown route 404s" "$WEB/no-such-page-here" "" -- 404

echo "== gated pages, signed out =="
assert_has "upload gated signed-out" "$WEB/upload" "" -- "Masuk dulu untuk mengunggah komik."
assert_has "creator apply gated signed-out" "$WEB/creator/apply" "" -- "Masuk dulu untuk mendaftar jadi kreator."
assert_has "admin gated signed-out" "$WEB/admin" "" -- "Halaman ini khusus admin."

echo "== nav per role =="
assert_nav "nav signed-out" "$WEB/" "" -- "href=\"/login\"" "++" "href=\"/library\"" "href=\"/upload\"" "href=\"/admin\""

READER_EMAIL=$(signup "$CK" reader)
ADMIN_EMAIL=$(signup "$CK_ADMIN" admin)

assert_nav "nav reader (shelf, no upload/admin)" "$WEB/" "$CK" -- "href=\"/library\"" "++" "href=\"/login\"" "href=\"/upload\"" "href=\"/admin\""
assert_has "upload shows the creator CTA to a reader" "$WEB/upload" "$CK" -- "Kamu masih pembaca. Daftar jadi kreator untuk mulai mengunggah."
assert_has "creator apply form renders for a reader" "$WEB/creator/apply" "$CK" -- "Kirim lamaran"
assert_has "admin gated for a reader" "$WEB/admin" "$CK" -- "Halaman ini khusus admin."

promote_admin "$ADMIN_EMAIL"
assert_nav "nav admin (shelf + upload + admin)" "$WEB/" "$CK_ADMIN" -- "href=\"/library\"" "href=\"/upload\"" "href=\"/admin\""
assert_has "admin queue renders applications" "$WEB/admin" "$CK_ADMIN" -- "Lamaran kreator"
assert_has "admin queue renders reports" "$WEB/admin" "$CK_ADMIN" -- "Laporan"
assert_has "admin takedown copy is honest" "$WEB/admin" "$CK_ADMIN" -- "termasuk pemiliknya"

echo "== creator sees the real upload form =="
CK_CREATOR="$WORK/creator.txt"
CREATOR_EMAIL=$(signup "$CK_CREATOR" creator)
if [ -n "$CREATOR_EMAIL" ]; then
	promote_role "$CREATOR_EMAIL" creator
	assert_nav "nav creator (shelf + upload, no admin)" "$WEB/" "$CK_CREATOR" -- "href=\"/library\"" "href=\"/upload\"" "++" "href=\"/admin\""
	assert_has "creator sees the comic form" "$WEB/upload" "$CK_CREATOR" -- "Buat komik"
	assert_lacks "creator no longer sees the reader CTA" "$WEB/upload" "$CK_CREATOR" -- "Kamu masih pembaca"
	# Step 2 only renders once the creator owns a comic — so create one
	# through the API and assert the chapter form appears.
	SMOKE_TITLE="Smoke Comic $(date +%s)"
	CREATED=$(curl -s -b "$CK_CREATOR" -X POST "$API/rpc/publishing/createComic" \
		-H 'content-type: application/json' \
		-d "{\"json\":{\"title\":\"$SMOKE_TITLE\",\"genres\":[\"action\"]}}")
	if printf '%s' "$CREATED" | grep -qF "$SMOKE_TITLE"; then
		pass "createComic through the API"
	else
		fail "createComic through the API — response: $(printf '%s' "$CREATED" | head -c 120)"
	fi
	assert_has "creator sees the chapter form once a comic exists" "$WEB/upload" "$CK_CREATOR" -- "Kirim bab"
else
	fail "creator checks — signup failed"
fi

echo
echo "SSR SMOKE: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then echo "SSR SMOKE FAILED"; exit 1; fi
echo "SSR SMOKE PASSED"
