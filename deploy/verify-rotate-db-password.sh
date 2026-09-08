#!/usr/bin/env bash
# End-to-end check of rotate-db-password.sh, without Docker and without a
# database.
#
#   bash deploy/verify-rotate-db-password.sh
#
# Run this before shipping any change to that script. It exists for the same
# reason verify-setup-admin.sh does: the failures that matter here are
# interactions between the script, Compose and the .env file, and no unit
# suite can see any of them. Two have already shipped broken from this
# directory -- a script calling a path no image contains, and a value with a
# '$' that Compose ate.
#
# The stakes are higher for this one. Its failure mode is a backend that cannot
# reach its database, and the obvious-looking fix for THAT is `down -v`, which
# destroys every room on the box.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "  ok: $1"; }

mkdir -p "$TMP/repo/deploy" "$TMP/bin"
cp "$REPO_ROOT/deploy/rotate-db-password.sh" "$TMP/repo/deploy/"
printf 'services:\n  db:\n    image: x\n  backend:\n    image: x\n' > "$TMP/repo/deploy/docker-compose.yml"
ENV_FILE="$TMP/repo/deploy/.env"

# A stub docker that records what it was asked to do. `ps` reports db running;
# `exec` succeeds; everything else is a no-op.
cat > "$TMP/bin/docker" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$TMP/docker.log"
case "\$*" in
  *" ps "*) echo "kvitlach-db" ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/docker"

# A stub curl so the health poll succeeds immediately rather than waiting 60s.
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$TMP/bin/curl"

printf 'ADMIN_USERNAME=someone\nPOSTGRES_PASSWORD=theoldone\n' > "$ENV_FILE"

run() { PATH="$TMP/bin:$PATH" bash "$TMP/repo/deploy/rotate-db-password.sh" "$@"; }

: > "$TMP/docker.log"
run >/dev/null

# --- what landed -------------------------------------------------------------
grep -q '^ADMIN_USERNAME=someone$' "$ENV_FILE" || fail "clobbered an unrelated .env line"
ok "left unrelated .env lines alone"

NEW="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
[ -n "$NEW" ] || fail "no POSTGRES_PASSWORD written"
[ "$NEW" != "theoldone" ] || fail "did not actually change the password"
[ "${#NEW}" -ge 24 ] || fail "generated password is too short: $NEW"
ok "generated a new password ($NEW)"

# The Compose trap, the one that has already cost this repo a deploy.
case "$NEW" in
  *'$'*) fail "generated password contains '\$' -- Compose will eat it: $NEW" ;;
esac
ok "generated password has no '\$' for Compose to eat"

# And the one specific to THIS value: it lives inside a URL.
case "$NEW" in
  *[:/@?\#%\[\]]*) fail "generated password would break the DATABASE_URL: $NEW" ;;
esac
ok "generated password is safe between ':' and '@' in the DATABASE_URL"

[ "$(grep -c '^POSTGRES_PASSWORD=' "$ENV_FILE")" = "1" ] || fail "duplicate POSTGRES_PASSWORD lines"
ok "replaces rather than appends"

# --- order of operations, which is the whole point of the script -------------
ALTER_LINE="$(grep -n 'ALTER USER' "$TMP/docker.log" | head -1 | cut -d: -f1)"
UP_LINE="$(grep -n 'up -d' "$TMP/docker.log" | head -1 | cut -d: -f1)"
[ -n "$ALTER_LINE" ] || fail "never issued an ALTER USER -- the role would keep its old password"
[ -n "$UP_LINE" ] || fail "never recreated the containers"
[ "$ALTER_LINE" -lt "$UP_LINE" ] || fail "recreated the containers before altering the role"
ok "alters the role BEFORE anything reads the new .env"

grep -q 'psql -q -h 127.0.0.1' "$TMP/docker.log" \
  || fail "never verified the new password over TCP, which is how the backend connects"
ok "verifies the new password the way the backend will use it"

grep -q 'down' "$TMP/docker.log" && fail "issued a 'down' -- never do that to this stack"
ok "never runs 'docker compose down'"

# The password must not appear in the host-visible command line.
grep -q "$NEW" "$TMP/docker.log" && fail "password appeared in argv, readable via ps: $NEW"
ok "password never reaches argv (it goes in on stdin)"

# --- refusing bad input ------------------------------------------------------
printf 'POSTGRES_PASSWORD=theoldone\n' > "$ENV_FILE"
if run 'has$dollar$signs' >/dev/null 2>&1; then
  fail "accepted a password containing '\$'"
fi
grep -q '^POSTGRES_PASSWORD=theoldone$' "$ENV_FILE" || fail "wrote .env despite refusing the password"
ok "refuses a '\$' password and writes nothing"

if run 'has@at:and/slash' >/dev/null 2>&1; then
  fail "accepted a password that would break the DATABASE_URL"
fi
ok "refuses a password that would break the DATABASE_URL"

if run 'short' >/dev/null 2>&1; then
  fail "accepted a five-character password"
fi
ok "refuses a too-short password"

# --- refuses to run when the db is down --------------------------------------
cat > "$TMP/bin/docker" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$TMP/docker.log"
exit 0
STUB
chmod +x "$TMP/bin/docker"
if run >/dev/null 2>&1; then
  fail "ran with no db container -- would have written .env against an unchanged role"
fi
grep -q '^POSTGRES_PASSWORD=theoldone$' "$ENV_FILE" || fail "changed .env with the db down"
ok "refuses to run when the db is not up, and changes nothing"

echo
echo "rotate-db-password.sh verified."
