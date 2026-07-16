# 角色识别库 (CharacterDB)

基于 Pinyin-Pro + 别名库的动态角色识别系统，支持从标题和 TAG 中智能识别二次元游戏角色。

## 特性

- **精确匹配**：角色全名精确识别
- **别名匹配**：支持昵称、常见误写识别
- **拼音匹配**：支持全拼、首字母、模糊拼音匹配
- **智能容错**：编辑距离算法处理拼写错误
- **可配置阈值**：自定义相似度和置信度阈值
- **Wiki 同步**：支持从 BWiki 自动同步角色数据

## 目录结构

```
character-db/
├── index.json              # 主索引文件
├── games/                  # 游戏角色数据
│   ├── genshin.json       # 原神
│   ├── starrail.json      # 崩坏：星穹铁道
│   ├── wuthering.json     # 鸣潮
│   └── azurlane.json      # 碧蓝航线
├── crawlers/              # 爬虫模块
│   └── bwiki-crawler.ts   # BWiki 爬虫
├── sync/                  # 同步模块
│   └── scheduler.ts       # 定时同步调度器
├── utils/                 # 工具模块
│   ├── pinyin-matcher.ts  # 拼音匹配器
│   └── alias-library.ts   # 别名库
├── types.ts               # 类型定义
├── character-db-service.ts # 主服务
└── index.ts               # 入口文件
```

## 快速开始

```typescript
import { getCharacterDBService } from '@/lib/character-db';

const dbService = getCharacterDBService();

// 加载数据库
await dbService.load();

// 在文本中识别角色
const matches = dbService.identifyInText('原神 雷电将军 cosplay');
// 结果: [{ character: { name: '雷电将军', ... }, matchType: 'exact', confidence: 1.0 }]

// 在 TAG 列表中识别角色
const tagMatches = dbService.identifyInTags(['ldjj', 'hutao', 'cosplay']);
// 结果: [{ character: { name: '雷电将军', ... }, matchType: 'alias', confidence: 1.0 }, ...]
```

## 配置选项

```typescript
const dbService = getCharacterDBService({
  // 拼音匹配相似度阈值 (0-1)，默认 0.6
  pinyinSimilarityThreshold: 0.6,

  // 是否启用模糊匹配，默认 true
  enableFuzzyMatch: true,

  // 是否启用别名库，默认 true
  enableAliasLibrary: true,

  // 最小匹配置信度，默认 0.5
  minConfidence: 0.5,
});
```

## 匹配类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `exact` | 精确匹配 | "雷电将军" → 雷电将军 |
| `alias` | 别名匹配 | "雷神" → 雷电将军 |
| `pinyin_full` | 全拼音匹配 | "leidianjiangjun" → 雷电将军 |
| `pinyin_initials` | 首字母匹配 | "ldjj" → 雷电将军 |
| `pinyin_fuzzy` | 模糊拼音匹配 | "leidianj" → 雷电将军 |
| `similar` | 相似度匹配 | 编辑距离容错 |

## 别名库

内置别名库包含常见错误拼写和昵称：

- **原神**: 雷神、雷电影、堂主、椰羊、白鹭公主...
- **星穹铁道**: 卡妈、妈妈、鸭鸭、蝴蝶、黄泉...
- **鸣潮**: 今州令尹、椿宝、守岸...
- **碧蓝航线**: 大E、女仆长、太太、大白狐狸...

### 自定义别名

```typescript
import { getAliasLibrary } from '@/lib/character-db';

const aliasLib = getAliasLibrary();

// 添加自定义别名规则
aliasLib.addRule({
  id: 'custom-1',
  targetId: 'genshin-raiden',
  aliases: ['自定义别名'],
  type: 'nickname',
  weight: 0.9,
});
```

## Wiki 同步

```typescript
import { getCharacterDBScheduler } from '@/lib/character-db';

const scheduler = getCharacterDBScheduler();

// 手动触发同步
await scheduler.runSync();

// 同步指定游戏
await scheduler.runSync(['genshin', 'starrail']);
```

## 测试

```bash
# 运行基础测试
npx tsx src/lib/character-db/test.ts

# 运行拼音匹配器测试
npx tsx src/lib/character-db/test-pinyin.ts
```

## 向后兼容

`GameCharacterService` 已迁移到使用 CharacterDB，保持原有 API 不变：

```typescript
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';

const service = getGameCharacterService();
const matches = await service.identifyInTags(['雷电将军', '原神']);
```
