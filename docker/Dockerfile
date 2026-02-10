# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/
RUN npx tsc

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/

USER appuser

# Default: ingress. Override with docker-compose command.
CMD ["node", "dist/ingress/server.js"]
