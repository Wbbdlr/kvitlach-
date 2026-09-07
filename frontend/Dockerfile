FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_WS_URL
ENV VITE_WS_URL=${VITE_WS_URL}

COPY package*.json tsconfig.json vite.config.ts tailwind.config.cjs postcss.config.cjs ./
# ci, not install -- see backend/Dockerfile. Nothing from node_modules ships
# here (the runtime stage is nginx serving dist/), but the build still has to
# be reproducible.
#
# Split out and run BEFORE the app-code COPYs below, same fix and same
# reasoning as backend/Dockerfile -- see its own comment. src/index.html/
# public all change on essentially every deploy, so npm ci used to sit
# downstream of a layer that never once cache-hit and reinstalled the whole
# tree from the registry every time, on both images, every deploy.
#
# --dns-result-order=ipv4first -- see backend/Dockerfile's own comment for
# the full reasoning (same fix, same evidence, same suspected cause).
RUN NODE_OPTIONS=--dns-result-order=ipv4first npm ci
COPY src ./src
COPY index.html ./
COPY public ./public
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 4173
CMD ["nginx", "-g", "daemon off;"]
