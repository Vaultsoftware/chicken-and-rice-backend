# Dockerfile  (root)
# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.13.1
FROM node:${NODE_VERSION}-slim AS base
LABEL fly_launch_runtime="Node.js"
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Africa/Lagos

# ---------- build stage ----------
FROM base AS build
# toolchain only for native deps; not copied to final
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

# install deps based on lockfile
COPY package-lock.json package.json ./
RUN npm ci

# bring app source
COPY . .

# hard guard: fail build if a legacy literal sneaks in
# (we fixed this to "/uploads/:path*"; this ensures it stays fixed)
RUN ! grep -RIn '"/uploads/:path(.*)"' . || (echo "❌ legacy /uploads route found" && exit 1)

# trim dev deps from node_modules for final image
RUN npm prune --omit=dev

# ---------- final image ----------
FROM base
# copy the pruned app
COPY --from=build /app /app

EXPOSE 5000
CMD ["node", "server.js"]
