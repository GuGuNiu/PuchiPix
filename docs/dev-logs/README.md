# 开发日志

本目录按日期组织开发日志，每个日期文件夹内包含按主题拆分的子文件和索引。

## 日期索引

| 日期 | 文件夹 | 概要 |
|------|--------|------|
| 2026-07-09 | [`260709/`](./260709/index.md) | SiteProvider 架构重构、璀璨黑 UI、搜索爬取分离、核心基础设施层、WebSocket 全链路修复 |
| 2026-07-10 | [`260710/`](./260710/index.md) | 卡片渲染优化、KanAV 元信息扩展、启动速度优化、倍速预览修复、任务管理增强、Turbopack 修复 |
| 2026-07-11 | [`260711/`](./260711/index.md) | 爱妹子 Provider 集成、图包下载、反爬虫升级、主角归一化、游戏角色识别、图库前端适配 |
| 2026-07-12 | [`260712/`](./260712/index.md) | ouo.io 下载流程端到端测试、IP 限速检测、chrome-error 捕获、RAR 解压支持、反检测增强、多线程下载、ZIP 优化、内容校验、OUO 任务编排器 |

## 目录结构

```
docs/dev-logs/
├── README.md           # 本文件（总索引）
├── 260709/
│   ├── index.md        # 当日索引
│   ├── 01-overview.md
│   ├── 02-siteprovider-architecture.md
│   └── ...
├── 260710/
│   ├── index.md
│   ├── 01-overview.md
│   └── ...
├── 260711/
│   ├── index.md
│   ├── 01-overview.md
│   └── ...
└── 260712/
    ├── index.md
    ├── 01-ouo-io-download-e2e-test.md
    ├── 02-anti-detect-and-parallel-download.md
    └── 03-gallery-zip-optimization-and-ouo-orchestrator.md
```

---

*按日期文件夹组织，每个文件夹内 `index.md` 为当日目录，子 md 文件按主题拆分。*