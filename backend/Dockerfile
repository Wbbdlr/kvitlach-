FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json vitest.config.ts ./
COPY src ./src
# ci, not install: install re-resolves the ^ ranges at build time, so the
# container could get different versions than the ones the test suite ran
# against. Security patches in particular have to be the exact resolved
# versions from package-lock.json.
RUN npm ci && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
# Production dependencies only. Copying the build stage's node_modules put
# vitest/vite/esbuild inside the running container -- nothing ever executes
# them there, but they sit on disk and dominate every image scan of it.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV PORT=3000
ENV WS_PORT=3001
EXPOSE 3000 3001
CMD ["node", "dist/index.js"]
