FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json vitest.config.ts ./
# ci, not install: install re-resolves the ^ ranges at build time, so the
# container could get different versions than the ones the test suite ran
# against. Security patches in particular have to be the exact resolved
# versions from package-lock.json.
#
# Run BEFORE `COPY src`, not combined into one RUN with the build step --
# this is the one line that makes this layer actually cacheable. `COPY src`
# changes on every deploy (app code always does); if npm ci sat after it in
# the same layer chain, Docker's sequential cache invalidates the moment src
# does, and a full dependency reinstall from the registry runs on every
# single deploy regardless of whether package.json changed at all. Reported
# repeatedly as the build looking "stuck" at this exact step -- it wasn't
# stuck, it just never once got to skip a real npm install. With ci split out
# first, a deploy that only touches src (most of them) now cache-hits this
# layer entirely.
#
# --dns-result-order=ipv4first: this box's Docker BUILD network path is
# already known to behave differently from a plain `docker run` -- it's the
# whole reason DOCKER_BUILDKIT=0 is required at all (legacy BuildKit couldn't
# resolve DNS through this server's resolver, see the deploy skill). Reported
# 2026-09-04 as npm ci hanging with zero output and no error mid-build, right
# after this layer was split out on its own -- registry.npmjs.org resolves
# instantly and answers a plain `docker run` wget in 0.13s, but its DNS
# answer lists IPv6 (Cloudflare, 2606:4700::...) ahead of IPv4. A build-stage
# network that can't actually route that IPv6 address produces exactly this
# signature: a silent black hole, not a fast refusal, because there is
# nothing to time out on to fall back from. Forcing IPv4 first removes the
# address family most likely to be the one that's broken here.
RUN NODE_OPTIONS=--dns-result-order=ipv4first npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
# Production dependencies only. Copying the build stage's node_modules put
# vitest/vite/esbuild inside the running container -- nothing ever executes
# them there, but they sit on disk and dominate every image scan of it.
# Same --dns-result-order fix as the build stage's npm ci -- this hits the
# same registry over the same build-stage network path.
RUN NODE_OPTIONS=--dns-result-order=ipv4first npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV PORT=3000
ENV WS_PORT=3001
EXPOSE 3000 3001
CMD ["node", "dist/index.js"]
