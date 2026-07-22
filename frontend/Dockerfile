FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build
ENV NEXT_TELEMETRY_DISABLED=1

FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 10540

ENV NODE_ENV=production
ENV PORT=10540
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "server.js"]
