---
name: deploy
description: Build and hand over a Kvitlach deploy tarball. Use whenever a push to main touches backend/ or frontend/, when the user asks to deploy, ship, push a build, or release a version, or when they report a change missing from the live site.
---

# Deploying Kvitlach

Deploys are RDP-driven, not CI. The user copies a tarball from their PC's
Downloads to the server's Downloads over RDP, then pastes one block into a
terminal there. CI (`.github/workflows/ci.yml`) runs tests on every push and
deploys nothing.

## When to do this without being asked

Whenever a push to `origin/main` touches `backend/` or `frontend/`, build the
tarball and hand it over **in that same turn**. Don't wait to be asked.

Skip it for doc-only pushes (README, CLAUDE.md, `docs/`, no runtime diff) —
nothing running needs to change.

## The four things a deploy turn must contain

A deploy turn is **not finished** until the user has all four, in that turn:

1. **The version** it is (`v8.5`).
2. **The tarball's path.**
3. **The one paste block.**
4. **The sha256**, so they can confirm the copy survived RDP.

Handing over a tarball with no paste block has actually happened — the user
was left holding a file and no way to apply it. Say all four even when the
previous turn already said three of them.

## Steps

1. **Bump `APP_VERSION` in `frontend/src/version.ts` by 0.1 first**, so the
   footer badge proves which build is live.

2. **Run `npx vite build` AFTER the bump, not just before.** The bump is a
   code edit and can break the build on its own: a scripted bump once
   truncated `version.ts` to zero bytes (the write handle was opened before
   the read ran), which passed every test that had already run and then
   failed the frontend image build on the server with `"APP_VERSION" is not
   exported`. Never edit a file by opening it for writing in the same
   expression that reads it — read into a variable first, or use `sed`.

3. **Build with `bash deploy/build-tarball.sh`. Never `git archive`.**
   That has actually happened too. `git archive` writes wherever you point it
   and silently omits anything uncommitted, so the user's next RDP copy grabs
   the stale `kvitlach-deploy.tar.gz` still sitting in Downloads and deploys
   the *previous* build while every version badge insists otherwise.

   The script writes `C:\Users\sws22\Downloads\kvitlach-deploy.tar.gz`,
   overwriting any previous one — there should only ever be one canonical
   "deploy this" tarball in Downloads. Confirm it landed in **Downloads**,
   not the repo. It packages `backend frontend deploy` from the **working
   tree**, excluding `node_modules`, `dist`, `.git`, `.env`, `.env.local`.

4. **Give exactly one block.** Never "run this, then run that" — the user
   pastes into an RDP terminal, and multiple blocks means multiple paste
   operations and more chances for error. Chain with `&&` instead.

   ```bash
   cd ~/docker/kvitlach && tar -xzf ~/Downloads/kvitlach-deploy.tar.gz && cd deploy && DOCKER_BUILDKIT=0 docker compose up -d --build backend frontend db && echo "DONE."
   ```

   Both containers build from source (Vite/tsc), so there is no lighter
   `docker compose cp`-and-restart path here. `DOCKER_BUILDKIT=0` is required
   — BuildKit can't resolve DNS through this server's resolver.

5. Report the sha256 and byte size.

## Before shipping a change to anything in `deploy/`

```bash
bash deploy/verify-setup-admin.sh
```

The unit suites cannot see this class of bug and both shipped anyway: a script
calling a path no image contains, and a `$` in `.env` that Compose ate. This
drives the real script against a throwaway tree with a stub `docker`, then
checks what landed in `.env` — no `$`, three hash parts, unchanged under
Compose-style interpolation, verifies against the password, wrong password
rejected, session secret not rotated on re-run.

**"The tests passed" is not evidence a deploy script works.** It was true both
times a broken one went out.

## Never

- **Never add `-v` to any `docker compose down`** in a command given to the
  user. It destroys the Postgres volume and every round and room in it.
- **Never tell the user to edit a file on the server.** Dockge only renders
  compose/`.env` editors for stacks inside its own stacks directory, and this
  stack lives in `~/docker/kvitlach`, so it has no editor. Scripts in
  `deploy/` do the writing — see the `admin-ops` skill.

## The runtime images contain less than the repo

`backend/Dockerfile`'s runtime stage copies **only `dist/`** — no `src/`, no
`scripts/`. Anything invoked as `docker compose exec backend <path>` must be
in `dist` or inlined as `node -e`. `setup-admin.sh` shipped broken once for
exactly this, calling `scripts/hash-password.mjs`, which is in the repo and in
no image. Check the Dockerfile's runtime stage before writing any in-container
path.

## Dependency warnings in the build log

`npm audit` findings and the "new major version of npm" notice are expected
and are **not** a reason to change anything mid-deploy. See the `deps` skill
before acting on them.
