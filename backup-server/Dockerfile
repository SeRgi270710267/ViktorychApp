# Pinned so a new Node release can never break a Render build by surprise.
FROM node:22.23.4-bookworm-slim

WORKDIR /app

# Shared Cloudflare mode needs no npm packages: Node 22 has fetch, streams
# and Web APIs built in. Miniflare (local mode) is a dev dependency only, so
# builds are fast and the image is small, which shortens cold starts.
COPY worker/src/ ./worker/src/
COPY shared/ ./shared/
COPY backup-server/package.json ./package.json
COPY backup-server/server.mjs ./server.mjs
COPY backup-server/cloudflare.mjs ./cloudflare.mjs
COPY backup-server/pool-room.mjs ./pool-room.mjs

ENV NODE_ENV=production
ENV PORT=10000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
# The free instance has 512 MB. A smaller heap makes V8 collect garbage
# before the container hits the limit and gets killed.
ENV NODE_OPTIONS="--max-old-space-size=320"

EXPOSE 10000

CMD ["node", "server.mjs"]
