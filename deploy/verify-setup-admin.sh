#!/usr/bin/env bash
# End-to-end check of setup-admin.sh, without Docker and without a server.
#
#   bash deploy/verify-setup-admin.sh
#
# Run this before shipping any change to setup-admin.sh. It exists because two
# tarballs went out broken in ways the unit suites cannot see:
#
#   1. the script called scripts/hash-password.mjs, which is in the repo and in
#      no image, so it died on its first line with MODULE_NOT_FOUND;
#   2. it wrote a scrypt hash containing '$' into deploy/.env, and Docker
#      Compose interpolated both halves away, so every admin login failed
#      against the correct password.
#
# Both are interactions between the script, the image and Compose. This drives
# the real script against a throwaway tree with a stub `docker` on PATH, then
# checks what actually landed in .env and whether the backend would accept it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASSWORD='p@ss$word/with"quotes and spaces'
USERNAME='Sws'

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "  ok: $1"; }

# --- a throwaway copy of the tree the script expects -------------------------
mkdir -p "$TMP/repo/deploy" "$TMP/repo/backend/scripts" "$TMP/bin"
cp "$REPO_ROOT/deploy/setup-admin.sh" "$TMP/repo/deploy/"
cp "$REPO_ROOT/backend/scripts/hash-password.mjs" "$TMP/repo/backend/scripts/"
printf 'services:\n  backend:\n    image: x\n' > "$TMP/repo/deploy/docker-compose.yml"

# A stub docker. `ps` prints nothing, so the script takes its host-node
# fallback -- which is also what happens on a box where the stack is down.
cat > "$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *" ps "*) exit 0 ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$TMP/bin/docker"

# Something unrelated already in .env, to prove it survives.
printf 'POSTGRES_PASSWORD=keepme\n' > "$TMP/repo/deploy/.env"

PATH="$TMP/bin:$PATH" bash "$TMP/repo/deploy/setup-admin.sh" "$USERNAME" "$PASSWORD" 127.0.0.1 >/dev/null
ENV_FILE="$TMP/repo/deploy/.env"

# --- what landed -------------------------------------------------------------
grep -q '^POSTGRES_PASSWORD=keepme$' "$ENV_FILE" || fail "clobbered an unrelated .env line"
ok "left unrelated .env lines alone"

HASH="$(grep '^ADMIN_PASSWORD_HASH=' "$ENV_FILE" | cut -d= -f2-)"
[ -n "$HASH" ] || fail "no ADMIN_PASSWORD_HASH written"

# (2) the Compose trap. Anything with a '$' in it is a live grenade in .env.
case "$HASH" in
  *'$'*) fail "hash contains '\$' -- Compose will interpolate it away: $HASH" ;;
esac
ok "hash contains no '\$' for Compose to eat"

[ "$(echo "$HASH" | awk -F: '{print NF}')" = "3" ] || fail "hash is not scrypt:salt:hash -- got $HASH"
ok "hash has all three parts"

# (2b) simulate Compose's own interpolation over the whole file and confirm
# nothing changes. This is the check that would have caught the shipped bug.
INTERPOLATED="$(python -c "
import os,re,sys
raw=open(sys.argv[1]).read()
# Compose expands \$VAR and \${VAR}; undefined ones become empty.
out=re.sub(r'\\\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?', lambda m: os.environ.get(m.group(1),''), raw)
print('CHANGED' if out!=raw else 'SAME')
" "$ENV_FILE")"
[ "$INTERPOLATED" = "SAME" ] || fail ".env changes under Compose-style interpolation"
ok ".env survives Compose interpolation unchanged"

# (1) and the real question: would the backend accept this password?
node -e '
const {scryptSync,timingSafeEqual}=require("node:crypto");
const stored=process.argv[1], provided=process.argv[2];
const sep = stored[6];
const [,salt,expected]=stored.split(sep);
if(!salt||!expected){console.error("unparseable hash");process.exit(1);}
const actual=scryptSync(provided,salt,32);
const exp=Buffer.from(expected,"hex");
if(actual.length!==exp.length||!timingSafeEqual(actual,exp)){console.error("password does NOT verify");process.exit(1);}
' "$HASH" "$PASSWORD" || fail "the written hash does not verify against the password"
ok "backend would accept the password"

node -e '
const {scryptSync}=require("node:crypto");
const stored=process.argv[1];
const [,salt]=stored.split(stored[6]);
const wrong=scryptSync("not the password",salt,32).toString("hex");
if(stored.endsWith(wrong)){console.error("wrong password verified");process.exit(1);}
' "$HASH" || fail "a wrong password verified"
ok "a wrong password does not verify"

grep -q '^ADMIN_SESSION_SECRET=.\{64\}$' "$ENV_FILE" || fail "no 64-char ADMIN_SESSION_SECRET"
ok "session secret generated"

SECRET_BEFORE="$(grep '^ADMIN_SESSION_SECRET=' "$ENV_FILE")"
PATH="$TMP/bin:$PATH" bash "$TMP/repo/deploy/setup-admin.sh" "$USERNAME" 'a different one' 127.0.0.1 >/dev/null
[ "$(grep '^ADMIN_SESSION_SECRET=' "$ENV_FILE")" = "$SECRET_BEFORE" ] \
  || fail "re-running rotated the session secret, signing everyone out"
ok "re-running keeps the session secret (does not sign you out)"
[ "$(grep -c '^ADMIN_PASSWORD_HASH=' "$ENV_FILE")" = "1" ] || fail "duplicate ADMIN_PASSWORD_HASH lines"
ok "re-running replaces rather than appends"

grep -q '^ADMIN_USERNAME=Sws$' "$ENV_FILE" || fail "username not written verbatim"
ok "username written verbatim (the backend lowercases it)"

echo
echo "setup-admin.sh verified."
