FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_WS_URL
ENV VITE_WS_URL=${VITE_WS_URL}

COPY package*.json tsconfig.json vite.config.ts tailwind.config.cjs postcss.config.cjs ./
COPY src ./src
COPY index.html ./
COPY public ./public
# ci, not install -- see backend/Dockerfile. Nothing from node_modules ships
# here (the runtime stage is nginx serving dist/), but the build still has to
# be reproducible.
RUN npm ci && npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 4173
CMD ["nginx", "-g", "daemon off;"]
