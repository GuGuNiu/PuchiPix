# 开发日志 — 2026-07-09 — 第三轮迭代 — 批量标题搜索自动下载

## 第三轮迭代 — 批量标题搜索自动下载

### 需求

在任务管理页面增加"搜索任务"按钮，支持批量导入视频标题（每行一个），由系统自动执行以下流程：

1. 以标题为关键词搜索站点
2. 对搜索结果标题进行模糊匹配，选取最佳匹配视频
3. 自动爬取视频页、提取 M3U8、创建下载任务
4. 内置反爬虫机制（标题间随机延迟 3~5 秒，翻页间 2~3 秒）
5. 失败任务和搜索不到的标题单独列出，供用户审查和重试

### 架构设计

```
┌─────────────────────────────────────────────────────┐
│  BatchSearchPanel (前端组件)                          │
│  - 标题输入框 + 站点选择                              │
│  - 进度条 + 统计卡片                                  │
│  - 结果审查表格（筛选：全部/未找到/失败）              │
│  - 复制失败标题 + 重试按钮                            │
└────────────────────�────────────────────────────────�
                     │ POST /api/search/batch
                     ▼
┌─────────────────────────────────────────────────────┐
│  SearchEngine.batchSearch() (后端搜索引擎)            │
│  - normalizeTitle()    标题归一化                     │
│  - titleSimilarity()   模糊匹配算法（0-1 分数）       │
│  - executeBatchSearch() 批量处理循环                  │
│    ├─ 搜索阶段：关键词 → 最多翻 2 页 → 收集候选       │
│    ├─ 匹配阶段：cleanTitle + 相似度排序 → 最佳匹配    │
│    ├─ 判断：分数 ≥ 0.6 → 继续 / < 0.6 → not_found     │
│    └─ 爬取阶段：视频页 → M3U8 → 创建下载任务 → 启动  │
│  - 反爬虫：标题间 3~5s 随机延迟，失败指数退避          │
└─────────────────────────────────────────────────────┘
```

### 类型定义 — `src/types/index.ts`

新增两个接口：

#### `BatchTitleResult`

描述单个标题的处理结果：

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | `string` | 用户输入的原始标题 |
| `status` | `'pending' \| 'searching' \| 'found' \| 'scraping' \| 'completed' \| 'not_found' \| 'failed'` | 处理状态 |
| `searchResults` | `SearchItem[]` | 搜索到的候选视频列表 |
| `selectedItem` | `SearchItem?` | 模糊匹配选中的最佳视频 |
| `taskId` | `number?` | 创建的下载任务 ID |
| `error` | `string?` | 错误信息 |
| `retries` | `number` | 重试次数 |
| `matchScore` | `number?` | 匹配分数（0-1） |

#### `BatchSearchJob`

描述批量搜索任务整体状态：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 任务唯一 ID |
| `titles` | `string[]` | 拆分后的标题列表 |
| `siteId` | `string` | 站点 ID |
| `status` | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'` | 任务状态 |
| `results` | `BatchTitleResult[]` | 每个标题的处理结果 |
| `totalProcessed` | `number` | 已处理数量 |
| `totalDownloaded` | `number` | 成功下载数量 |
| `totalNotFound` | `number` | 未找到匹配数量 |
| `totalFailed` | `number` | 处理失败数量 |
| `currentIndex` | `number` | 当前处理索引 |
| `logs` | `SearchLogEntry[]` | 日志条目 |

### 搜索引擎 — `src/lib/search/search-engine.ts`

#### 新增常量

| 常量 | 值 | 说明 |
|---|---|---|
| `BATCH_MAX_PAGES` | 2 | 每个标题最大翻页数 |
| `BATCH_TITLE_DELAY_MIN` | 3000ms | 标题间最小间隔 |
| `BATCH_TITLE_DELAY_MAX` | 5000ms | 标题间最大间隔 |
| `MATCH_THRESHOLD` | 0.6 | 模糊匹配阈值 |

#### `normalizeTitle(s: string): string`

标题归一化函数：去除空格、标点、特殊字符，转小写。用于在比较前消除格式差异。

```typescript
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_—–·:：.,，。！!？?·\[\]（）()【】"'<>《》/|]+/g, '')
    .trim();
}
```

#### `titleSimilarity(input: string, candidate: string): number`

模糊匹配算法，返回 0-1 的相似度分数：

| 策略 | 条件 | 分数 |
|---|---|---|
| 精确匹配 | 归一化后完全相同 | 1.0 |
| 包含匹配 | 一方包含另一方 | 0.85 × (较短长度 / 较长长度) |
| 字符重叠 | 其他情况 | 共同字符数 / 最大长度 |

#### `batchSearch(rawTitles: string, siteId?: string): Promise<BatchSearchJob>`

启动批量搜索任务：

1. 按行拆分标题（`\n` 分隔）
2. 创建 `BatchSearchJob` 对象
3. 异步调用 `executeBatchSearch()`

#### `executeBatchSearch(job: BatchSearchJob, provider: SiteProvider): Promise<void>`

批量处理循环，对每个标题执行以下阶段：

**阶段 1 — 搜索**：
- 以标题为关键词构造搜索 URL
- 最多翻 `BATCH_MAX_PAGES`（2）页
- 3 次重试 + 指数退避（2s/4s/8s/16s）
- 翻页间隔 2~3 秒

**阶段 2 — 模糊匹配**：
- 对每条搜索结果调用 `provider.cleanTitle()` 清洗标题
- 调用 `titleSimilarity()` 计算与输入标题的相似度
- 按分数降序排序

**阶段 3 — 判断阈值**：
- 最高分 ≥ 0.6 → 标记 `found`，进入爬取阶段
- 最高分 < 0.6 或无结果 → 标记 `not_found`，延迟后处理下一个

**阶段 4 — 爬取**：
- 爬取最佳匹配视频页 → 提取 M3U8 URL
- kanav 屏蔽器二次检查
- 创建 Prisma 下载任务 → 启动下载
- 标记 `completed`，`job.totalDownloaded++`

**反爬虫延迟**：每个标题处理完成后等待 3~5 秒随机延迟。

#### 管理方法

| 方法 | 说明 |
|---|---|
| `getBatchJob(jobId)` | 获取单个批量任务状态 |
| `getAllBatchJobs()` | 获取所有批量任务 |
| `cancelBatchJob(jobId)` | 取消批量任务 |

### 新增 API 路由

#### `POST /api/search/batch`

启动批量搜索任务。

**请求体**：
```json
{
  "titles": "视频标题1\n视频标题2\n视频标题3",
  "siteId": "kanav"
}
```

**响应**（201）：
```json
{
  "id": "batch_1752065671684_abc123",
  "titles": ["视频标题1", "视频标题2"],
  "siteId": "kanav",
  "status": "running",
  "results": [...],
  "totalProcessed": 0,
  "totalDownloaded": 0,
  "totalNotFound": 0,
  "totalFailed": 0
}
```

#### `GET /api/search/batch/:id`

获取批量搜索任务状态（前端每 2 秒轮询）。

**响应**（200）：完整的 `BatchSearchJob` 对象。

#### `DELETE /api/search/batch/:id`

取消正在运行的批量搜索任务。

**响应**（200）：
```json
{ "message": "Batch search job cancelled", "id": "batch_xxx" }
```

#### `GET /api/search/batch`

获取所有批量搜索任务列表。

### 前端组件 — `src/components/tasks/batch-search-panel.tsx`

#### 布局结构

```
�─────────────────────────────────────────────────────┐
│  � 批量搜索任务                               [展开] │
├─────────────────────────────────────────────────────┤
│  ┌────────────────────────────� ┌──────────────────┐ │
│  │ 视频标题列表（textarea）     │ │ 站点选择 [kanav] │ │
│  │ 支持每行一个标题            │ │ [开始搜索下载]   │ │
│  │                            │ │ [取消] (运行中)  │ │
│  └────────────────────────────� └──────────────────┘ │
│  检测到 42 个标题 · 自动模糊搜索 · 3~5s 防爬虫间隔    │
├─────────────────────────────────────────────────────┤
│  ███████░░░░░░░░░ 进度: 15/42 (36%)                  │
│  ┌────────┐ �────────� ┌────────┐ ┌────────�       │
│  │ 已下载  │ │ 未找到  │ │ 失败   │ │ 总计   │       │
│  │   12   │ │   2    │ │   1    │ │  42   │       │
│  └────────� └────────┘ └────────┘ └────────�       │
│  [复制失败/未找到标题]  [重试失败标题]                 │
│  ● 全部(42)  ○ 未找到(2)  ○ 失败(1)  [显示日志]      │
│  ┌──────────────────────────────────────────────┐   │
│  │ # │ 输入标题     │ 匹配结果    │ 分数  │ 状态  │   │
│  │ 1 │ xxx         │ yyy        │ 0.92 │ 已完成│   │
│  │ 2 │ aaa         │ —          │ 0.00 │未找到 │   │
│  └──────────────────────────────────────────────┘   │
│  [日志面板，最近 50 条]                               │
└─────────────────────────────────────────────────────┘
```

#### 关键功能

| 功能 | 说明 |
|---|---|
| 展开/收起 | 默认收起，点击"搜索任务"展开输入面板 |
| 标题输入 | textarea，每行一个标题，自动计数 |
| 站点选择 | 下拉选择，从 `/api/sites` 动态获取 |
| 进度显示 | 进度条 + 4 个统计卡片（已下载/未找到/失败/总计） |
| 结果筛选 | 可按"全部/未找到/失败"筛选结果表格 |
| 审查操作 | "复制失败标题"→ 复制到剪贴板；"重试失败标题"→ 填入输入框 |
| 日志面板 | 可展开/收起，显示最近 50 条操作日志 |

#### 结果表格字段

| 列 | 说明 |
|---|---|
| `#` | 序号 |
| 输入标题 | 用户输入的原始标题 |
| 匹配结果 | 模糊匹配选中的最佳视频标题 |
| 分数 | 相似度分数（0-1），≥ 0.6 绿色显示 |
| 状态 | pending/searching/found/scraping/completed/not_found/failed |
| 任务 | 创建的下载任务编号 |

### 任务管理页面 — `src/app/tasks/page.tsx`

在"添加新任务"卡片上方插入 `BatchSearchPanel` 组件。任务完成后自动调用 `fetchTasks()` 刷新下方下载任务列表。

### 新增文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/app/api/search/batch/route.ts` | 46 | `POST` 启动批量搜索，`GET` 列出所有批量任务 |
| `src/app/api/search/batch/[id]/route.ts` | 48 | `GET` 获取任务状态，`DELETE` 取消任务 |
| `src/components/tasks/batch-search-panel.tsx` | 354 | 批量搜索面板组件（输入 + 进度 + 审查） |

### 修改文件

| 文件 | 变更 |
|---|---|
| `src/types/index.ts` | 新增 `BatchTitleResult`、`BatchSearchJob` 接口 |
| `src/lib/search/search-engine.ts` | 新增批量搜索逻辑（normalizeTitle、titleSimilarity、batchSearch、executeBatchSearch 等） |
| `src/app/tasks/page.tsx` | 引入 `BatchSearchPanel` 组件并插入页面顶部 |

### 关键算法说明

#### 模糊匹配流程

```
输入标题 → normalizeTitle → 与每个候选标题（cleanTitle 后）比较
                                        ↓
                            三级策略：精确(1.0) > 包含(0.85×r) > 字符重叠
                                        ↓
                            按分数降序排序 → 取最高分
                                        ↓
                           ≥ MATCH_THRESHOLD(0.6) → 爬取
                           < MATCH_THRESHOLD(0.6) → not_found
```

#### 反爬虫策略

| 场景 | 延迟 | 说明 |
|---|---|---|
| 翻页间隔 | 2~3s 随机 | 搜索阶段页与页之间 |
| 标题间隔 | 3~5s 随机 | 每个标题处理完后 |
| 搜索重试 | 指数退避 2s/4s/8s/16s | 失败后重试 |
| 错误处理 | 标记失败，继续下一个 | 不影响后续标题处理 |

### 验证结果

- `POST /api/search/batch` → `201`，任务启动成功
- `GET /api/search/batch/:id` → `200`，实时状态更新正常
- `DELETE /api/search/batch/:id` → `200`，任务取消成功
- 任务管理页面 → `BatchSearchPanel` 组件正常渲染，展开/收起正常
- 进度条和统计卡片 → 实时更新
- 结果审查表格 → 筛选、复制、重试功能正常
- 所有 Linter 检查通过，无错误
- TypeScript 编译通过（仅修改类型错误）

---
