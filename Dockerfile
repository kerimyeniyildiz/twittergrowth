FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 may need native build tools if prebuilt binary is unavailable
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY .env.example ./.env.example
COPY README.md ./README.md

RUN mkdir -p /app/data

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
