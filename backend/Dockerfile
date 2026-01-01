FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json vitest.config.ts ./
COPY src ./src
RUN npm install && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV PORT=3000
ENV WS_PORT=3001
EXPOSE 3000 3001
CMD ["node", "dist/index.js"]
