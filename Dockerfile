# ============================================
# 依赖安装
# ============================================
FROM node:22-alpine AS deps
WORKDIR /app

# 安装 pnpm
RUN corepack enable pnpm

# 复制依赖文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 安装生产依赖
RUN pnpm install --frozen-lockfile --prod

# ============================================
# 构建应用
# ============================================
FROM node:22-alpine AS builder
WORKDIR /app

# 安装 pnpm 和构建所需工具
RUN corepack enable pnpm

# 复制所有依赖
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 生成 Prisma Client
RUN pnpm prisma:generate

# 构建 Next.js（standalone 模式）
RUN pnpm build
ENV NEXT_TELEMETRY_DISABLED=1

# ============================================
# 生产运行
# ============================================
FROM node:22-alpine AS runner
WORKDIR /app

# 安装 tini 作为 init 进程
RUN apk add --no-cache tini

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# 从构建阶段复制 standalone 输出
# Next.js standalone 模式会将 server.ts 编译为 server.js 并放在 .next/standalone 根目录
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 复制 Prisma schema（运行时 migrate 需要）
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# 创建数据目录并设置权限
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# 切换到非 root 用户
USER nextjs

# 暴露端口（与 server.ts 默认端口一致）
EXPOSE 10540

# 环境变量
ENV NODE_ENV=production
ENV PORT=10540
ENV HOSTNAME="0.0.0.0"

# 使用 tini 作为 entrypoint 处理信号
ENTRYPOINT ["/sbin/tini", "--"]

# 启动命令（Next.js standalone 编译后的入口文件）
CMD ["node", "server.js"]
