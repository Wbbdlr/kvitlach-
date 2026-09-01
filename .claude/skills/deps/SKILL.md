---
name: deps
description: What the npm audit findings, npm major-version notice and browserslist warning in Kvitlach's build output actually mean, and which are worth acting on. Use when the user asks about upgrading dependencies, security vulnerabilities, or warnings printed during a docker build.
---

# Dependency warnings

The server build prints three kinds of noise. Assessed 2026-09-01; re-run
`npm audit --json` in `frontend/` before trusting the specifics.

## `7 vulnerabilities (4 moderate, 2 high, 1 critical)`

**The critical one is `vitest`.** It is a test runner: it never reaches a
browser, is not in any deployed image, and does not run on the server. The
same is true of `vite`, `vite-node` and `esbuild` — that group is all one
advisory about the **dev server** being reachable from a malicious website,
which only matters while someone is running `npm run dev` locally.

| package | severity | ships to users? | real exposure here |
|---|---|---|---|
| vitest | critical | no — dev only | none |
| vite / vite-node / esbuild | high / mod | no — dev only | dev machine, only while `npm run dev` runs |
| nanoid | high | **yes** | **none** — see below |
| react-router / -dom | moderate | **yes** | low — see below |

- **nanoid** — the advisory is an infinite loop when called with a zero or
  negative `size`. Both call sites pass a constant: `nanoid(8)` in
  `frontend/src/ws.ts:130` and `customAlphabet` in `backend/src/store.ts`.
  No attacker-reachable size, so it is not reachable at all.
- **react-router** — two issues: an open redirect via a backslash in `<Link>`,
  and constructor injection in `deserializeErrors()` during **SSR hydration**.
  There is no SSR here (a Vite SPA served by nginx), so the second does not
  apply. The first needs an attacker-controlled link target; links are built
  from room ids.

**Every fix is `isSemVerMajor: true`**, which is why `npm audit fix` refuses
without `--force`. React Router 6→7 is the one to be most careful with:
`router.tsx`'s single catch-all route is deliberate and fragile (splitting it
remounts `App` and wedges `status` on "connecting"), and a major upgrade is
exactly the change that would disturb it.

**Recommendation: don't upgrade mid-deploy, and never run `npm audit fix
--force` to make a build log quieter.** Do the dev-only group (vite/vitest)
as its own change with a full test run, when nothing else is in flight. Leave
react-router alone until there is a reason beyond the audit number.

## `New major version of npm available! 10.8.2 -> 12.0.2`

Ignore it. That is npm *inside the `node:20-alpine` build stage*. The image
pins it, builds use `npm ci` against the committed lockfile, and the container
is thrown away after the build. Upgrading npm inside a Dockerfile adds a
network step and a moving part to every build and changes nothing about the
output.

The version of node itself is worth revisiting eventually — node 20 leaves
maintenance in 2026 — but that is a deliberate change with a test run, not a
build-log reaction.

## `caniuse-lite is 9 months old`

Cosmetic, and the one genuinely worth doing. It only affects which
autoprefixer rules and browser targets are applied — stale data means slightly
conservative CSS output, never a broken build.

```bash
cd frontend && npx update-browserslist-db@latest
```

It updates `package-lock.json`, so it is a commit like any other. Do it when
touching the frontend anyway, not as its own deploy.
