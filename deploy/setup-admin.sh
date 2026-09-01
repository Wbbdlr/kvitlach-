#!/usr/bin/env bash
# Configures the admin panel without opening an editor.
#
#   bash deploy/setup-admin.sh '<username>' '<password>' [bind-address]
#
# Dockge only shows the compose and .env files for stacks inside its own
# stacks directory; this one lives in ~/docker/kvitlach, so it renders as an
# external stack with no editor. Rather than move the stack, this writes the
# five settings itself, restarts the backend and prints the URL to open.
#
# Idempotent: re-running with a new password replaces the hash and leaves
# everything else alone. Existing unrelated .env lines are untouched.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/deploy/.env"

USERNAME="${1:-}"
PASSWORD="${2:-}"
BIND="${3:-0.0.0.0}"

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  echo "usage: bash deploy/setup-admin.sh '<username>' '<password>' [bind-address]" >&2
  echo "  bind-address defaults to 0.0.0.0 (LAN + Tailscale). Use 127.0.0.1 for" >&2
  echo "  server-only, or the box's 100.x.y.z Tailscale IP for tailnet-only." >&2
  exit 1
fi

# Hash inside the running container so this needs no node on the host. Falls
# back to the host's node if the container is not up yet (first-time setup
# before the stack has ever started).
#
# The hashing is inlined rather than calling scripts/hash-password.mjs, because
# backend/Dockerfile's runtime stage copies only dist -- scripts/ is not in the
# image and never has been. Inlining also means this works against whatever
# image is ALREADY running, which matters: you need the hash in order to
# configure the panel, so it cannot depend on first deploying a fixed image.
# Keep in step with hashPassword() in backend/src/admin-auth.ts (scrypt, 32).
HASH_JS='const {randomBytes,scryptSync}=require("node:crypto");const s=randomBytes(16).toString("hex");console.log("ADMIN_PASSWORD_HASH=scrypt$"+s+"$"+scryptSync(process.env.KV_PW,s,32).toString("hex"));'

hash_password() {
  if docker compose -f "$REPO_ROOT/deploy/docker-compose.yml" ps --status running backend 2>/dev/null | grep -q backend; then
    # Password goes through the environment, not argv: argv is visible in `ps`
    # to every other user on the box for as long as the hash takes to compute.
    docker compose -f "$REPO_ROOT/deploy/docker-compose.yml" exec -T -e KV_PW="$1" backend node -e "$HASH_JS"
  else
    KV_PW="$1" node -e "$HASH_JS"
  fi
}

HASH_LINE="$(hash_password "$PASSWORD" | tr -d '\r')"
case "$HASH_LINE" in
  ADMIN_PASSWORD_HASH=scrypt\$*) ;;
  *) echo "could not hash the password (got: $HASH_LINE)" >&2; exit 1 ;;
esac

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Replaces a key if present, appends it if not. Values go through a temp file
# rather than sed's replacement text: a scrypt hash contains '$' and '/', both
# of which sed would otherwise eat.
set_key() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

set_key ADMIN_USERNAME "$USERNAME"
# Written with ':' separators, not the '$' that hashPassword emits. Docker
# Compose interpolates .env, so `scrypt$salt$hash` has both halves read as
# undefined variables and expands to the bare word "scrypt" -- the backend then
# rejects the correct password forever, with a warning nobody reads. Compose
# documents '$$' as the escape, but a value containing no '$' cannot be eaten
# by Compose, a shell, sed or an editor at all. verifyPassword accepts both.
RAW_HASH="${HASH_LINE#ADMIN_PASSWORD_HASH=}"
set_key ADMIN_PASSWORD_HASH "${RAW_HASH//\$/:}"
set_key ADMIN_BIND "$BIND"
# Only generated once: rotating it would sign out every open session, which is
# a surprise nobody wants from re-running a setup script to change a password.
if ! grep -q '^ADMIN_SESSION_SECRET=' "$ENV_FILE"; then
  set_key ADMIN_SESSION_SECRET "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
# The old query-string mechanism. Cleared here because it is strictly worse
# than the login once the port is reachable from other machines, and leaving a
# stale token behind means a second, weaker way in that nobody remembers.
set_key ADMIN_TOKEN ""

echo "Wrote $ENV_FILE"
docker compose -f "$REPO_ROOT/deploy/docker-compose.yml" up -d backend

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Admin panel ready. Sign in as: $USERNAME"
echo "  on this server : http://127.0.0.1:25000/admin"
[ -n "$HOST_IP" ] && echo "  from the LAN   : http://$HOST_IP:25000/admin"
command -v tailscale >/dev/null 2>&1 && \
  echo "  over Tailscale : http://$(tailscale ip -4 2>/dev/null | head -1):25000/admin"
echo
echo "Bound to $BIND. Re-run this script to change the password."
