FROM node:20-alpine AS build
WORKDIR /app

# Allow the WebSocket endpoint to be injected at build time for Vite.
ARG VITE_WS_URL
ENV VITE_WS_URL=${VITE_WS_URL}

COPY package*.json tsconfig.json vite.config.ts tailwind.config.cjs postcss.config.cjs ./
COPY src ./src
COPY index.html ./
COPY public ./public
RUN npm install && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
RUN npm install -g serve
EXPOSE 4173
CMD ["serve", "-s", "dist", "-l", "4173"]
