# syntax=docker/dockerfile:1

# ---- Build stage: Rust (wasm target) + Node 24, builds wasm, npm workspaces, web bundle ----
FROM node:24-bookworm AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates build-essential pkg-config \
  && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && /root/.cargo/bin/rustup target add wasm32-unknown-unknown
ENV PATH="/root/.cargo/bin:${PATH}"

# Vite exposes VITE_* from the process environment; they are baked into the bundle.
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ENV VITE_AUTH0_DOMAIN=${VITE_AUTH0_DOMAIN} \
    VITE_AUTH0_CLIENT_ID=${VITE_AUTH0_CLIENT_ID} \
    VITE_AUTH0_AUDIENCE=${VITE_AUTH0_AUDIENCE}

WORKDIR /app
COPY . .
RUN npm ci \
  && npm run build

# ---- Server image: Node API on port 3001 ----
FROM node:24-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/contract ./contract
COPY --from=build /app/compiler ./compiler
COPY --from=build /app/history ./history
COPY --from=build /app/server ./server
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev

WORKDIR /app/server
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# ---- Web image: static bundle + /api reverse proxy via Caddy ----
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
EXPOSE 80 443
