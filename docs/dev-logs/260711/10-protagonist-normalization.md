# 开发日志 — 2026-07-11 — 功能八：主角名字归一化与展示架功能

## 功能八：主角名字归一化与展示架功能

### 8.1 背景问题

在爬取爱妹子等图库站点时，发现同一个主角有多种命名变体：

| 原始标题 | 提取的主角名 | 问题 |
|---------|-------------|------|
| `[写真] 樱井宁宁 - 纯白毛衣` | 樱井宁宁 | ✅ 标准名 |
| `樱井宁宁ningning - 作品A` | 樱井宁宁ningning | ❌ 混名 |
| `樱井宁宁yingjingningning - 作品B` | 樱井宁宁yingjingningning | ❌ 混名 |
| `桜井宁宁 - 作品C` | 桜井宁宁 | ❌ 异体字 |

这导致：
1. 搜索"樱井宁宁"时无法找到所有相关图库
2. 主角个人页面分散，无法完整展示
3. 数据统计不准确

### 8.2 解决方案

实现了一套**主角名字归一化系统**，核心特性：

1. **二元解析**：将混名拆分为中文部分 + 拼音/英文部分
2. **拼音归一**：使用 `pinyin` 库将中文转换为标准拼音
3. **相似度计算**：基于 Levenshtein 编辑距离计算名字相似度
4. **频率统计**：查询数据库，选择出现频率最高的名字作为标准名
5. **别名保留**：在展示架中显示所有识别到的别名

### 8.3 依赖安装

```bash
pnpm add pinyin
```

### 8.4 核心服务

**文件**: `src/lib/protagonist/protagonist-service.ts`

#### 8.4.1 混名解析算法

```typescript
parseMixedName("樱井宁宁ningning")
// 结果: { chinese: "樱井宁宁", pinyin: "ningning", isMixed: true }

parseMixedName("樱井宁宁")
// 结果: { chinese: "樱井宁宁", pinyin: "", isMixed: false }
```

#### 8.4.2 拼音归一化

```typescript
toStandardPinyin("樱井宁宁")
// 结果: "yingjingningning"

toStandardPinyin("桜井宁宁")  // 日语异体字
// 结果: "yingjingningning"  // 相同拼音
```

#### 8.4.3 相似度计算

使用 Levenshtein 编辑距离算法：

```typescript
calculateSimilarity("樱井宁宁ningning", "樱井宁宁")
// 中文部分相同 → 相似度 > 0.7

calculateSimilarity("yingjingningning", "yingjingningning")
// 拼音完全匹配 → 相似度 = 1.0
```

#### 8.4.4 数据库归一化

```typescript
async normalizeFromDatabase("樱井宁宁ningning")
// 流程:
// 1. 解析混名 → { chinese: "樱井宁宁", pinyin: "ningning" }
// 2. 查询数据库中所有主角名
// 3. 计算与每个名字的相似度
// 4. 统计相似名字的出现频率
// 5. 返回频率最高的名字作为标准名

// 结果:
{
  rawName: "樱井宁宁ningning",
  standardName: "樱井宁宁",  // 数据库中最常出现的标准名
  chinesePart: "樱井宁宁",
  pinyinPart: "ningning",
  isMixedName: true,
  confidence: 0.95,
  matchedAliases: ["樱井宁宁", "桜井宁宁", "yingjingningning"]
}
```

### 8.5 集成到爬虫

**文件**: `src/lib/sites/providers/aimeizizi-provider.ts`

新增 `extractProtagonistNormalized` 方法：

```typescript
async extractProtagonistNormalized(title: string, tags: string[]): Promise<string> {
  // 1. 先使用原有逻辑提取原始名字
  const rawName = this.extractProtagonist(title, tags);

  // 2. 使用主角服务进行归一化
  const service = getProtagonistService();
  const result = await service.normalizeFromDatabase(rawName);

  // 3. 记录归一化日志
  console.log(
    `[Aimeizizi] 主角名字归一化: "${rawName}" → "${result.standardName}" ` +
    `(置信度: ${(result.confidence * 100).toFixed(1)}%)`
  );

  return result.standardName;
}
```

在 `scrapeGallery` 中使用：

```typescript
// 提取主角和描述（使用归一化服务）
const protagonist = await this.extractProtagonistNormalized(title, firstPageData.tags);
```

### 8.6 主角展示架

#### 8.6.1 API 路由

**文件**: `src/app/api/protagonists/route.ts`

- `GET /api/protagonists` - 获取所有主角列表
- `GET /api/protagonists?name=xxx` - 获取指定主角详情

#### 8.6.2 页面结构

**主角列表页**: `src/app/protagonists/page.tsx`

功能：
- 网格展示所有主角
- 显示每个主角的图库数量
- 显示最新封面图
- 支持搜索过滤

**主角详情页**: `src/app/protagonists/[name]/page.tsx`

功能：
- 显示主角的标准名字
- 列出所有识别到的别名（混名归并结果）
- 展示该主角的所有图库
- 一键下载全部图库

#### 8.6.3 数据展示示例

以"樱井宁宁"为例：

```
主角: 樱井宁宁
图库数量: 15

别名（已归并）:
- 樱井宁宁ningning (3)
- 樱井宁宁yingjingningning (2)
- 桜井宁宁 (1)

图库列表:
1. [写真] 樱井宁宁 - 纯白毛衣
2. 樱井宁宁ningning - 作品A
3. 樱井宁宁yingjingningning - 作品B
...
```

### 8.7 设计决策

#### 8.7.1 为什么不在数据库中存储别名映射？

**决策**: 数据库只存储原始爬取的数据，不强制修正主角名。

**原因**:
1. **数据完整性**: 保留原始数据，便于追溯
2. **灵活性**: 归一化算法可以持续改进，不影响历史数据
3. **展示需求**: 在展示架中显示别名，让用户了解数据来源

**实现方式**:
- 数据库: 存储原始 `protagonist` 字段
- 查询时: 使用相似度算法动态归并

#### 8.7.2 相似度阈值设置

```typescript
const SIMILARITY_THRESHOLD = 0.6;  // 60% 相似度视为同一人
```

**考量**:
- 太低: 可能误合并不同人（如"张三"和"张三丰"）
- 太高: 可能漏掉同一人的变体（如"樱井宁宁"和"樱井寧寧"）
- 60% 是一个经验值，可根据实际数据调整

#### 8.7.3 频率优先策略

归一化时优先选择出现频率最高的名字作为标准名：

```typescript
// 策略: 频率 > 相似度
if (count > maxCount) {
  standardName = name;
}
```

**原因**:
- 出现频率高的名字通常是更标准的写法
- 避免被某个罕见的变体影响

### 8.8 未来扩展

#### 8.8.1 人工校正

增加人工校正功能：
- 管理员可以手动设置标准名字
- 将某些名字标记为"非同一人"
- 保存人工规则到数据库

#### 8.8.2 机器学习

使用更高级的算法：
- 训练基于 BERT 的中文名相似度模型
- 考虑上下文信息（如标签、分类）
- 学习用户点击行为

#### 8.8.3 跨站点归一

目前只在单站点内归一，未来可支持：
- 跨站点识别同一主角
- 统一不同站点的命名差异
- 建立全局主角 ID 系统

### 8.9 文件清单

| 文件 | 说明 |
|------|------|
| `src/lib/protagonist/protagonist-service.ts` | 主角名字归一化服务 |
| `src/lib/sites/providers/aimeizizi-provider.ts` | 集成归一化到爬虫 |
| `src/app/api/protagonists/route.ts` | 主角展示架 API |
| `src/app/protagonists/page.tsx` | 主角列表页面 |
| `src/app/protagonists/[name]/page.tsx` | 主角详情页面 |

### 8.10 测试建议

1. **混名解析测试**
   ```typescript
   parseMixedName("樱井宁宁ningning") // { chinese: "樱井宁宁", pinyin: "ningning" }
   parseMixedName("樱井宁宁") // { chinese: "樱井宁宁", pinyin: "" }
   ```

2. **相似度测试**
   ```typescript
   calculateSimilarity("樱井宁宁", "桜井宁宁") // > 0.8
   calculateSimilarity("樱井宁宁", "张三") // < 0.3
   ```

3. **归一化测试**
   - 先爬取几个"樱井宁宁"的变体
   - 检查是否归并到同一个标准名
   - 验证别名列表是否正确

### 8.11 总结

主角名字归一化系统解决了图库爬取中的命名不一致问题，通过：

1. **智能解析**: 二元拆分混名
2. **拼音归一**: 消除异体字差异
3. **频率统计**: 自动确定标准名
4. **别名展示**: 保留原始数据信息

配合主角展示架页面，用户可以：
- 方便地浏览所有主角
- 查看某个主角的全部图库（包括各种命名变体）
- 一键下载某个主角的所有作品

这是一个**很特别**的功能，体现了对用户体验的深入思考。

---
