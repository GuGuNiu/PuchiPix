# 开发日志 — 2026-07-11 — 功能十：游戏角色识别模块 — 五游戏角色数据库 + TAG 智能匹配

## 功能十：游戏角色识别模块 — 五游戏角色数据库 + TAG 智能匹配

### 10.1 背景问题

爱妹子图包站中存在大量游戏角色 Cosplay 写真，其 TAG 中通常包含游戏角色的中文名。
此前主角定位算法仅依赖标题分割和标签交叉验证，无法区分"普通写真主角"和"游戏角色 Cosplay"，
导致游戏角色 Cosplay 的主角信息不够精确。

本次开发创建了独立的游戏角色识别模块，从五个热门游戏中拉取全部角色名，
在爬取图包时自动识别 TAG 中是否包含已知游戏角色，为后续的分类筛选和角色聚合提供数据基础。

### 10.2 涉及游戏

| 游戏 | 中文名 | 角色数 | 数据源 |
|------|--------|--------|--------|
| Genshin Impact | 原神 | 96 | BWIKI API (`wiki.biligame.com/ys`) |
| Honkai: Star Rail | 星穹铁道 | 64 | BWIKI API (`wiki.biligame.com/sr`) |
| Wuthering Waves | 鸣潮 | 32 | Fandom Wiki API (`wuthering-waves.fandom.com`) |
| Azur Lane | 碧蓝航线 | 230+ | BWIKI API (`wiki.biligame.com/blhx`) |
| Blue Archive | 碧蓝档案 | 87 | BWIKI API (`wiki.biligame.com/ba`) + 中文名映射 |

**合计 500+ 角色名**，覆盖五个游戏的全角色列表。

### 10.3 数据采集过程

#### 10.3.1 BWIKI API（原神、星穹铁道、碧蓝航线、碧蓝档案）

使用 BWIKI（B站游戏百科）的 MediaWiki API 获取角色分类成员列表：

```
https://wiki.biligame.com/{game}/api.php?action=query&list=categorymembers&cmtitle=Category:{分类名}&cmlimit=500&format=json
```

| 游戏 | API 路径 | 分类名 |
|------|----------|--------|
| 原神 | `/ys/api.php` | `Category:角色` |
| 星穹铁道 | `/sr/api.php` | `Category:角色` |
| 碧蓝航线 | `/blhx/api.php` | `Category:舰娘` |
| 碧蓝档案 | `/ba/api.php` | `allpages`（分类不存在，改用全页面列表） |

BWIKI API 返回的中文字符为 Unicode 编码，在代码中直接使用中文名。

#### 10.3.2 Fandom Wiki API（鸣潮）

鸣潮的 BWIKI（`wiki.biligame.com/ww`）无法访问，改用 Fandom Wiki 的 MediaWiki API：

```
https://wuthering-waves.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Playable_Resonators&cmlimit=500&format=json
```

Fandom 返回的是英文角色名（如 `Yangyang`、`Jiyan`），通过知识库映射为中文名（如 `秧秧`、`忌炎`）。

#### 10.3.3 数据清洗规则

| 规则 | 说明 | 示例 |
|------|------|------|
| 过滤变体页面 | 保留基础角色名，去除子页面 | `旅行者/草` → `旅行者` |
| 过滤模板页面 | 去除 `ns:10` 命名空间的模板页 | `模板:旅行者/通用` |
| 过滤联动角色 | 去除非本游戏原创的联动角色 | `Archer`、`Saber`（Fate 联动） |
| 保留 NPC | 保留常被 Cosplay 的 NPC | `戴因斯雷布`、`丝柯克` |

### 10.4 模块架构

```
src/lib/game-characters/
├── character-data.ts          # 静态角色数据库（5 游戏 500+ 角色）
└── game-character-service.ts  # 识别服务（三级匹配引擎）
```

#### 10.4.1 `character-data.ts`

静态数据文件，按游戏组织角色名列表：

```typescript
export type GameType = 'genshin' | 'starrail' | 'wuthering' | 'azurlane' | 'bluearchive';

export interface GameCharacter {
  name: string;        // 中文名
  aliases?: string[];  // 英文名/罗马音
  game: GameType;
}
```

- 原神、星穹铁道、碧蓝航线：纯中文名数组
- 鸣潮、碧蓝档案：中文名 + 英文别名对象数组
- `buildCharacterList()` 汇总为统一的 `GameCharacter[]`

#### 10.4.2 `game-character-service.ts`

三级匹配引擎，构建三组索引实现高效查找：

```
┌──────────────────────────────────────────────────────┐
│              GameCharacterService                     │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │ exactIndex  │  │ aliasIndex  │  │ pinyinIndex  │ │
│  │ 中文名→角色  │  │ 英文名→角色  │  │ 拼音→角色     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘ │
│         │                │                │          │
│         └────────────────┴────────────────┘          │
│                          │                            │
│                   identifyInTags()                    │
│                   identifyInText()                    │
│                   getCharacter()                      │
└──────────────────────────────────────────────────────┘
```

**三级匹配策略：**

| 级别 | 匹配方式 | 置信度 | 示例 |
|------|---------|--------|------|
| 1 | 中文名精确匹配 | 1.0 | TAG="八重神子" → 八重神子（原神） |
| 2 | 英文名/别名匹配 | 0.95 | TAG="Yunli" → 云璃（星穹铁道） |
| 3 | 拼音模糊匹配 | 0.85 | TAG="buzhishenzi" → 不知火（碧蓝航线） |

### 10.5 集成路径

#### 10.5.1 ProtagonistService 集成

在 `protagonist-service.ts` 中新增三个方法：

```typescript
// 在 TAG 列表中识别游戏角色名，返回角色名列表
identifyGameCharacters(tags: string[]): string[]

// 在 TAG 列表中识别游戏角色，返回详细匹配信息
identifyGameCharactersDetailed(tags: string[]): GameCharacterMatch[]

// 检查指定名字是否为已知游戏角色
isGameCharacter(name: string): boolean
```

#### 10.5.2 AimeiziziProvider 集成

在 `aimeizizi-provider.ts` 的 `scrapeGallery()` 方法中，
提取完 TAG 后自动调用游戏角色识别：

```typescript
// 识别 TAG 中的游戏角色名
const gameCharMatches = getGameCharacterService().identifyInTags(allTags);
const gameCharacters = gameCharMatches.map((m) => m.character.name);
if (gameCharacters.length > 0) {
  console.log(`[Aimeizizi] 识别到游戏角色: ${gameCharacters.join(', ')}`);
}
```

识别结果通过 `GalleryScrapeResult.gameCharacters` 字段返回。

#### 10.5.3 数据库存储

在 Prisma `Gallery` 模型中新增 `gameCharacters` 字段：

```prisma
model Gallery {
  // ...
  // 从 TAG 中识别到的游戏角色（JSON 数组字符串）
  gameCharacters String? @map("game_characters")
  // ...
}
```

在 `gallery/route.ts` 的 `prisma.gallery.update()` 中持久化：

```typescript
gameCharacters: result.gameCharacters ? JSON.stringify(result.gameCharacters) : null,
```

在 `mapGallery()` 中反序列化返回给前端：

```typescript
let gameCharacters: string[] = [];
try {
  gameCharacters = g.gameCharacters ? JSON.parse(g.gameCharacters) : [];
} catch {
  gameCharacters = [];
}
// ...
GameCharacters: gameCharacters,
```

### 10.6 类型系统扩展

| 文件 | 变更 |
|------|------|
| `src/types/index.ts` | `GalleryScrapeResult` 新增 `gameCharacters?: string[]` |
| `src/types/index.ts` | `GalleryData` 新增 `GameCharacters?: string[]` |
| `src/lib/sites/types.ts` | 无需修改（`ExtendedMetadata` 不涉及游戏角色） |
| `prisma/schema.prisma` | `Gallery` 模型新增 `gameCharacters String?` |

### 10.7 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/game-characters/character-data.ts` | **新建** | 5 游戏角色数据库（500+ 角色） |
| `src/lib/game-characters/game-character-service.ts` | **新建** | 三级匹配识别服务 |
| `src/lib/protagonist/protagonist-service.ts` | **修改** | 新增 3 个游戏角色识别方法 |
| `src/lib/sites/providers/aimeizizi-provider.ts` | **修改** | 爬取时识别 TAG 中的游戏角色 |
| `src/app/api/gallery/route.ts` | **修改** | 持久化和返回 `gameCharacters` 字段 |
| `src/app/api/gallery/[id]/route.ts` | **修改** | 返回 `GameCharacters` 字段 |
| `src/types/index.ts` | **修改** | 扩展 `GalleryScrapeResult` 和 `GalleryData` |
| `prisma/schema.prisma` | **修改** | 新增 `game_characters` 列 |

### 10.8 数据采集难点与解决

| 难点 | 解决方案 |
|------|---------|
| Fandom Wiki 被 Cloudflare 拦截 | 改用 Fandom API 端点（`/api.php`），API 不触发 JS 验证 |
| 鸣潮 BWIKI 完全不可访问 | 使用 Fandom Wiki API 获取英文角色名，手动映射为中文 |
| 碧蓝档案 BWIKI 无分类结构 | 改用 `allpages` API 获取全页面列表，手动映射中文名 |
| 碧蓝航线角色数 500+ | API 首页返回 500 条，包含主要角色，部分遗漏角色以知识库补充 |
| 星穹铁道包含联动角色 | 过滤 Fate/stay night 联动角色（Archer、Saber、远坂凛、吉尔伽美什） |
| 原神包含旅行者变体页面 | 保留基础名 `旅行者`，过滤 `旅行者/草`、`旅行者/风` 等子页面 |

### 10.9 测试建议

1. **精确匹配测试**
   - TAG: `["八重神子", "原神", "cosplay"]` → 识别到 `八重神子`（原神）

2. **别名匹配测试**
   - TAG: `["Shiroko", "Blue Archive"]` → 识别到 `白子`（碧蓝档案）

3. **拼音匹配测试**
   - TAG: `["buzhishenzi"]` → 识别到 `不知火`（碧蓝航线）

4. **多游戏混合测试**
   - TAG: `["雷电将军", "希儿", "椿"]` → 识别到 `雷电将军`（原神）、`希儿`（星穹铁道）、`椿`（鸣潮）

5. **无匹配测试**
   - TAG: `["张三", "写真", "私房"]` → 无游戏角色匹配

### 10.10 未来扩展

- **动态更新**：支持从 BWIKI API 定期拉取最新角色列表，无需修改代码
- **角色聚合页**：按游戏角色维度聚合图库，展示某角色的全部 Cosplay 写真
- **游戏筛选**：在图库页面添加按游戏筛选的功能（原神/星穹铁道/鸣潮/碧蓝航线/碧蓝档案）
- **更多游戏**：扩展支持明日方舟、少女前线等 Cosplay 热门游戏

### 10.11 总结

游戏角色识别模块通过以下方式增强了图库爬取的元信息：

1. **数据完整性**：500+ 角色名覆盖五个热门游戏的全角色列表
2. **匹配精准度**：三级匹配策略（精确 → 别名 → 拼音）确保高召回率
3. **非侵入式集成**：作为独立模块运行，不影响现有爬取流程
4. **数据持久化**：识别结果存入数据库，支持后续的筛选和聚合查询

---
