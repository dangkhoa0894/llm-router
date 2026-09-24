FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# From `builder`, not `base` — this is the stage that actually ran
# `prisma generate`, so its node_modules/.prisma/client exists.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
COPY public ./public

EXPOSE 3000

# Applies any pending migrations before starting — safe to run on every
# boot since `migrate deploy` is a no-op when the DB is already current.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
