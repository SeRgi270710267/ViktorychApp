FROM node:22-bookworm-slim

# Set working directory
WORKDIR /app

# Install dependencies first for Docker caching
COPY backup-server/package.json ./package.json
RUN npm install --omit=dev

# Copy application files
COPY worker/ ./worker/
COPY shared/ ./shared/
COPY backup-server/server.mjs ./server.mjs

# Default port (Render standard 10000)
ENV PORT=10000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

EXPOSE 10000

# Persistent storage volume
VOLUME ["/data"]

# Run the backup accounts server
CMD ["node", "server.mjs"]
