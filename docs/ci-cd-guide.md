# PuchiPix CI/CD 配置说明

本文档描述项目的 GitHub Actions 持续集成/持续部署配置。

@date 2026-07-13

## 工作流概览

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Actions                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │     CI      │    │     CD      │    │  Dependabot  │     │
│  │  (ci.yml)   │    │  (cd.yml)   │    │ (dependabot) │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
│    push/PR 触发        tag/手动触发        每周一自动        │
│         │                  │                  │             │
│    ┌────▼────┐        ┌────▼────┐        ┌────▼────┐       │
│    │  Lint   │        │  Build  │        │  Update  │       │
│    │  Type   │        │  Push   │        │   PR     │       │
│    │  Check  │        │ Deploy  │        │          │       │
│    └─────────┘        └─────────┘        └──────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## CI 工作流 (`.github/workflows/ci.yml`)

### 触发条件
- 推送到 `main` 或 `develop` 分支
- 针对 `main` 分支的 Pull Request

### 任务

| 任务 | 说明 | 依赖 |
|------|------|------|
| `lint` | ESLint 代码检查 + TypeScript 类型检查 | 无 |
| `build` | 安装依赖 → Prisma 生成 → Next.js 构建 | `lint` |

### 并发控制
- 同一分支的新运行会自动取消旧运行，避免资源浪费

## CD 工作流 (`.github/workflows/cd.yml`)

### 触发条件
- 推送到 `main` 分支（自动部署 Staging）
- 推送 `v*` 标签（自动部署 Production）
- 手动触发（可选择环境）

### 任务

| 任务 | 说明 | 依赖 |
|------|------|------|
| `build-and-push` | 构建 Docker 镜像 → 推送到 GHCR | 无 |
| `deploy-staging` | 部署到 Staging 环境 | `build-and-push` |
| `deploy-production` | 部署到 Production 环境 | `build-and-push` + `deploy-staging` |

### 镜像标签策略
- `latest` - 最新 main 分支构建
- `v{version}` - 语义化版本标签（如 `v2.0.0`）
- `v{major}.{minor}` - 主版本标签（如 `v2.0`）
- `sha-{commit}` - 提交哈希（如 `sha-a1b2c3d`）

## 所需配置

### GitHub Secrets
在仓库 Settings → Secrets and variables → Actions 中添加：

| 名称 | 说明 | 必需 |
|------|------|------|
| `GITHUB_TOKEN` | 自动提供，用于推送 GHCR | ✅ 自动 |

### GitHub Variables
在 Settings → Secrets and variables → Actions → Variables 中添加：

| 名称 | 说明 | 示例 |
|------|------|------|
| `STAGING_URL` | Staging 环境地址 | `https://staging.puchipix.com` |
| `PRODUCTION_URL` | Production 环境地址 | `https://puchipix.com` |

### 环境保护规则
建议为 `production` 环境配置保护规则：
- 需要指定人员审批
- 等待时间（可选）

## 部署脚本自定义

CD 工作流中的部署步骤需要根据你的服务器环境自定义。常见方案：

### SSH 部署
```yaml
- name: Deploy via SSH
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.SERVER_HOST }}
    username: ${{ secrets.SERVER_USER }}
    key: ${{ secrets.SSH_PRIVATE_KEY }}
    script: |
      docker pull ghcr.io/your-org/puchipix:latest
      docker compose up -d
```

### Kubernetes 部署
```yaml
- name: Deploy to K8s
  run: |
    kubectl set image deployment/puchipix \
      puchipix=ghcr.io/your-org/puchipix:sha-${GITHUB_SHA::7}
```

### 云服务 API
```yaml
- name: Deploy to cloud
  run: |
    # 调用阿里云/腾讯云/AWS API 更新容器服务
```

## 本地 Docker 测试

```bash
# 构建镜像
pnpm docker:build

# 运行容器
pnpm docker:run

# 或使用 docker compose
docker compose up -d
```

## Dependabot 配置 (`.github/dependabot.yml`)

自动检查并创建 PR 更新依赖：
- **频率**: 每周一 09:00 (Asia/Shanghai)
- **分组**: Next.js 生态、Prisma、TypeScript、Tailwind CSS
- **限制**: 最多 10 个同时打开的 PR
- **主版本**: Next.js 和 React 的主版本更新需手动确认

## 修订记录

| 日期 | 版本 | 修订内容 |
|------|------|---------|
| 2026-07-13 | 1.0 | 初始版本 |
