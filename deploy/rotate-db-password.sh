#!/usr/bin/env bash
# Rotates the Postgres password, live, without losing the database.
#
#   bash deploy/rotate-db-password.sh            # generates a strong one
#   bash deploy/rotate-db-password.sh '<password>'
#
# WHY THIS IS A SCRIPT AND NOT "EDIT deploy/.env"
#
# POSTGRES_PASSWORD only does anything on a container's FIRST init against an
# EMPTY data volume -- that is Postgres's own behaviour, not this compose
# file's. On an already-initialized deployment (this one) the role keeps the
# password it was created with, so changing only the .env line leaves the role
# untouched and breaks DATABASE_URL on the next `up`. The backend then cannot
# reach the database at all, and the obvious-looking fix for that is
# `docker compose down -v`, which destroys every room and round on the box.
#
# So the real rotation is two steps in a fixed order: ALTER the role first,
# against the password it has NOW, and only then write the new value where
# DATABASE_URL reads it.
#
# Safe to re-run. If anything fails before .env is written, the role is put
# back the way it was and nothing else is touched.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$REPO_ROOT/deploy/docker-compose.yml"
ENV_FILE="$REPO_ROOT/deploy/.env"

dc() { docker compose -f "$COMPOSE" "$@"; }

# The password lands in TWO places that both mangle characters, so the
# generated alphabet is deliberately narrow:
#
#   - deploy/.env, which Docker Compose interpolates. A '$' is read as a
#     variable and silently expands to nothing. ADMIN_PASSWORD_HASH already
#     taught this file that lesson the expensive way (see setup-admin.sh).
#   - DATABASE_URL, where it sits between ':' and '@' in a URL. Any of
#     : / @ ? # % [ ] would end the password early or be read as an escape.
#
# Hex has none of them, needs no encoding anywhere, and 32 characters is 128
# bits -- far past anything that matters for a role reachable only from inside
# one Docker network.
generate() { head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

NEW="${1:-$(generate)}"

# Same alphabet enforced on a password somebody supplies. Rejecting a password
# is a five-second inconvenience; accepting one that Compose eats is a backend
# that cannot reach its database and a very confusing hour.
case "$NEW" in
  *[!A-Za-z0-9._-]*)
    echo "Refusing that password: use only letters, digits, dot, underscore or hyphen." >&2
    echo "Anything else risks being eaten by Compose interpolation or the DATABASE_URL." >&2
    exit 1
    ;;
esac
if [ "${#NEW}" -lt 12 ]; then
  echo "Refusing that password: at least 12 characters, please." >&2
  exit 1
fi

# What the role has right now, so a failure can put it back. The default
# matches docker-compose.yml's own `${POSTGRES_PASSWORD:-kvitlach}`.
OLD="kvitlach"
if [ -f "$ENV_FILE" ] && grep -q '^POSTGRES_PASSWORD=' "$ENV_FILE"; then
  OLD="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi

if ! dc ps --status running db 2>/dev/null | grep -q db; then
  echo "The db container is not running. Start the stack first:" >&2
  echo "  cd $REPO_ROOT/deploy && docker compose up -d db" >&2
  exit 1
fi

# The password crosses into the container on STDIN, and this detail is worth
# being pedantic about.
#
# The obvious way -- `docker compose exec -e KV_PW="$1"` -- looks like it uses
# the environment, and it does at the far end. But that string is argv of the
# `docker` process on the HOST, readable by any other user on the box via `ps`
# for as long as the command runs. Stdin is not. The verifier greps the recorded
# command line for the password precisely to keep this honest, and it caught the
# `-e` form here on the first run.
#
# Interpolating into SQL like this is safe only because of the charset check
# above: there is no quote, backslash or semicolon this value can carry. The
# single quotes are expanded by the shell INSIDE the container.
alter_to() {
  printf '%s\n' "$1" | dc exec -T db sh -c \
    'read -r KV_PW; echo "ALTER USER kvitlach WITH PASSWORD '"'"'$KV_PW'"'"';" | psql -q -U kvitlach -d kvitlach -v ON_ERROR_STOP=1'
}

# Proves the new password actually authenticates the way the BACKEND will use
# it -- over TCP, through pg_hba's scram rule -- rather than over the local
# socket, which the official image trusts without a password and would happily
# pass whatever we gave it.
verify_login() {
  printf '%s\n' "$1" | dc exec -T db sh -c \
    'read -r P; PGPASSWORD="$P" psql -q -h 127.0.0.1 -U kvitlach -d kvitlach -v ON_ERROR_STOP=1 -c "SELECT 1"' >/dev/null 2>&1
}

echo "Changing the role password..."
alter_to "$NEW"

if ! verify_login "$NEW"; then
  echo "The new password did not authenticate over TCP. Putting the old one back." >&2
  alter_to "$OLD" || echo "  ...and THAT failed too. The role may now have the new password: $NEW" >&2
  echo "Nothing was written to $ENV_FILE." >&2
  exit 1
fi
echo "  ok: the role accepts it over TCP, which is how the backend connects."

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Replaces the key if present, appends it if not. Through a temp file rather
# than sed -i's replacement text, for the same reason setup-admin.sh does it:
# sed eats characters this value is allowed to contain.
set_key() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

set_key POSTGRES_PASSWORD "$NEW"
echo "  ok: wrote $ENV_FILE"

# Both services, deliberately. Only the backend reads DATABASE_URL, but the db
# service's own environment references POSTGRES_PASSWORD too -- leaving it
# stale means the NEXT unrelated `up -d` recreates it at a moment nobody is
# watching. The data volume is untouched by a recreate; this is not, and must
# never become, `down -v`.
echo "Recreating the containers..."
dc up -d db backend

echo
echo "Waiting for the backend to come back..."
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:25000/health >/dev/null 2>&1; then
    echo "  ok: backend is answering /health"
    echo
    echo "Done. The new password is in $ENV_FILE (chmod 600); nothing needs to be copied anywhere."
    exit 0
  fi
  sleep 2
done

# Not a silent failure: at this point the role and .env agree, so the backend
# SHOULD connect -- but saying "done" without having seen it answer would be
# exactly the kind of unverified claim this file's whole comment block is about.
echo "  The backend did not answer /health within 60s. The password change itself succeeded" >&2
echo "  (verified over TCP above) and $ENV_FILE is written, so this is something else." >&2
echo "  Look at:  docker compose -f $COMPOSE logs --tail 50 backend" >&2
echo "  Do NOT run 'docker compose down -v' -- it would destroy the database volume." >&2
exit 1
