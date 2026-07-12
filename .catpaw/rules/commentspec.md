---
ruleType: Always
description: 项目注释规范 - 确保代码注释质量和一致性
globs: *.ts, *.tsx, *.js, *.jsx, *.go, *.py, *.rs, *.css
---
rule编写规则: https://catpaw.meituan.com/guides/settings/rules

# PuchiPix 项目注释规范

## 1. 总则

本规范旨在确保代码注释的质量和一致性，提高代码可读性和可维护性。

## 2. 基本原则

### 2.1 非必要不写注释
- 代码本身应具有自解释性，优先通过清晰的命名和结构表达意图
- 注释仅用于补充代码无法直接表达的上下文信息
- 能通过变量名、函数名、类型定义理解的内容，不添加注释

### 2.2 一眼可见的代码不写注释
```typescript
// 坏的示例 - 不需要注释
const name: string = "张三"; // 定义一个字符串变量name，值为张三

// 好的示例 - 不添加注释
const userName: string = "张三";
```

### 2.3 太简单的内容不写注释
```typescript
// 坏的示例 - 过于简单无需注释
i++; // i自增1

// 坏的示例 - 显而易见的类型转换
const str = num.toString(); // 将数字转为字符串
```

### 2.4 不在注释内写故事
```typescript
// 坏的示例 - 讲述开发历程
// 这个函数最初是为了处理用户登录，后来经过三次重构，
// 在2024年5月的时候我们决定改用JWT方案...

// 好的示例 - 直接说明当前逻辑
// JWT 令牌过期时触发重登录，避免静默失效
```

## 3. 语言规范

### 3.1 默认使用中文注释
- 项目默认使用中文编写注释
- 中文能够清晰表达的场景，不使用英文

### 3.2 允许使用英文注释的场景
变量名、函数名等代码标识符必须使用英文时，对应的注释可以使用英文保持一致性：

```typescript
// 变量名为英文时，注释可以是英文
const userID: string = "123"; // unique identifier of user

// 变量名为英文但需用中文解释时，使用中文注释
const fps: number = 60; // 视频帧率，每秒显示的帧数
```

### 3.3 禁止中英文炫技
```typescript
// 坏的示例 - 无意义的炫技
// 这个function用来实现牛逼的data fetching功能，简直awesome！

// 坏的示例 - 过度使用英文
// This method will initialize the configuration loader and parse JSON.

// 好的示例 - 清晰简洁的中文注释
// 初始化配置加载器并解析 JSON
```

## 4. 注释格式规范

### 4.1 单行注释
使用 `//` 进行单行注释，注释前保留一个空格：
```typescript
// 正确的单行注释格式
const value = 42;
```

### 4.2 多行注释
多行注释应保持对齐，每行以 `//` 开头：
```typescript
// 这是第一行注释
// 这是第二行注释
// 这是第三行注释
```

### 4.3 JSDoc 注释（API 文档）
公共函数、类、SDoc 格式：

```typescript
/**
 * 计算视频下载进度
 * @param downloaded - 已下载字节数
 * @param totalBytes - 总字节数
 * @returns 下载进度百分比（0-100）
 */
function calculateProgress(downloaded: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min((downloaded / totalBytes) * 100, 100);
}
```

## 5. 不同场景的注释要求

### 5.1 模块/文件级注释（必须包含时间戳）
大文件或复杂模块必须添加详细的头部注释，包含时间戳：

```typescript
/**
 * 模块：视频下载管理器
 * 
 * 负责视频下载任务的创建、调度、进度追踪和异常处理。
 * 支持 M3U8、MP4 格式的下载，支持断点续传。
 * 
 * @author PuchiPix Team
 * @date 2026-07-09
 * @lastModified 2026-07-09
 */
```

### 5.2 复杂业务逻辑注释（必须包含时间戳）
复杂算法、业务逻辑、非直观的实现必须添加详细注释：

```typescript
/**
 * 计算重试延迟时间（指数退避算法）
 * 
 * 采用指数退避策略避免请求风暴：
 * - 第1次重试：延迟 1 秒
 * - 第2次重试：延迟 2 秒
 * - 第3次重试：延迟 4 秒
 * - 最大延迟不超过 30 秒
 * 
 * @date 2026-07-09
 */
function calculateBackoffDelay(retryCount: number): number {
  const baseDelay = 1000;
  const maxDelay = 30000;
  return Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
}
```

### 5.3 组件/页面注释
React 组件应说明其职责和主要 Props：

```typescript
/**
 * 视频搜索结果卡片组件
 * 
 * 展示视频标题、缩略图、时长、来源等信息。
 * 支持点击播放和收藏操作。
 * 
 * @param video - 视频数据对象
 * @param onPlay - 播放回调函数
 * @date 2026-07-09
 */
interface VideoCardProps {
  video: Video;
  onPlay: (id: string) => void;
}

export function VideoCard({ video, onPlay }: VideoCardProps) {
  // 组件实现
}
```

### 5.4 API 路由注释
API 路由应说明请求方式、参数、返回值：

```typescript
/**
 * 创建下载任务
 * 
 * POST /api/tasks
 * 
 * @param url - 视频源地址
 * @param format - 下载格式（m3u8/mp4）
 * @returns 任务ID和初始状态
 * 
 * @date 2026-07-09
 */
export async function POST(request: Request) {
  // 实现代码
}
```

### 5.5 数据库模型/Schema 注释
Prisma 模型字段含义：

```typescript
model Task {
  id        String   @id @default(cuid())
  // 视频源地址
  url       String
  // 任务状态：pending | downloading | completed | failed
  status    String   @default("pending")
  // 下载进度（0-100）
  progress  Float    @default(0)
  // 创建时间
  createdAt DateTime @default(now())
  // 更新时间
  updatedAt DateTime @updatedAt
}
```

### 5.6 临时/待办注释（必须包含时间戳）
标记待完成或需要优化的代码：

```typescript
// TODO [2026-07-09]: 添加下载速度限制功能
// FIXME [2026-07-09]: 大文件下载时内存溢出问题
// HACK [2026-07-09]: 临时修复 ffmpeg 编码兼容性问题，需后续重构
// NOTE [2026-07-09]: 此逻辑依赖第三方 API 的特定返回格式，变更需谨慎
```

## 6. 禁止事项清单

| 禁止行为 | 示例 |
|---------|------|
| 中英文炫技 | `这个 function 用来 fetch 数据，非常 awesome` |
| 注释内写故事 | `记得那是2024年的冬天，我们决定重构...` |
| 显而易见的注释 | `i++ // i增加1` |
| 重复代码的注释 | `const name = "张三" // 把张三赋值给name变量` |
| 过时未更新的注释 | 代码已修改但注释未同步 |
| 情绪化注释 | `/* 这段代码真的很烂，但是没时间改 */` |
| 无意义注释 | `// 这里开始`、`// 结束` |
| 大段注释掉的代码 | 删除无用代码，不要注释掉保留 |

## 7. 时间戳格式

所有需要时间戳的注释使用以下格式：

- 创建日期：`@date YYYY-MM-DD`
- 待办事项：`TODO [YYYY-MM-DD]: 描述`
- 最后修改：`@lastModified YYYY-MM-DD`
- 标记注释：`FIXME [YYYY-MM-DD]: 描述`

## 8. 检查清单

提交代码前，检查以下事项：

- [ ] 所有注释使用中文（变量名相关除外）
- [ ] 无炫技式的中英文混用
- [ ] 无故事性、情绪化、无意义注释
- [ ] 复杂逻辑已添加详细注释和 `@date` 时间戳
- [ ] 文件级注释已包含 `@date` 和 `@lastModified`
- [ ] TODO/FIXME 等标记包含时间戳
- [ ] 无注释代码
- [ ] 注释与代码逻辑保持一致

## 9. 修订记录

| 日期 | 版本 | 修订内容 |
|------|------|---------|
| 2026-07-09 | 1.0 | 初始版本 |
