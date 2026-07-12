# PuchiPix UI 优化设计文档

## 概述

本文档记录 PuchiPix 项目的 UI 优化思路与执行方案，涵盖左侧导航栏（Sidebar）和首页仪表盘（Dashboard）的视觉升级。核心方向：**提升排版呼吸感、增加行间距、优化边缘处理、注入高级质感**。

---

## 一、设计原则

### 1.1 玻璃拟态（Glassmorphism）深化
- 所有卡片/面板统一使用 `backdrop-filter: blur(16px) saturate(1.4)`
- 增加内发光阴影：`0 0 0 1px rgba(255, 255, 255, 0.4) inset`，模拟玻璃边缘高光
- 背景渐变叠加，增强层次深度

### 1.2 间距体系升级
- 全局区块间距从 `20px` 提升到 `24px`
- 页面内边距从 `24px 32px` 提升到 `32px 40px`
- 卡片内部 padding 统一增加 2-4px
- 元素间最小呼吸空间不低于 `4px`

### 1.3 圆角层次
- 小元素（按钮、标签）：`10px` (`radius-sm`)
- 中等卡片（导航项、活动项）：`14px` (`radius-md`)
- 大面板（统计面板、图表、活动流）：`22px` (`radius-xl`)

### 1.4 微动效规范
- 默认过渡：`0.15s ease`
- 弹性过渡（hover 动效）：`0.3s cubic-bezier(0.34, 1.56, 0.64, 1)`
- 缓慢过渡（背景色变化）：`0.25s ease`
- 数字滚动：`0.6s ease-out cubic`

### 1.5 字体层次
- 标题/大数字：字重 700-800，字间距 `-0.3px ~ -0.8px`
- 标签/说明：字重 600-700，字间距 `0.2px ~ 0.8px`
- 数值显示：等宽字体（JetBrains Mono），增强数据感

---

## 二、左侧导航栏（Sidebar）优化

### 2.1 问题诊断
- 导航项间距过密（`margin-bottom: 1px`）
- 选中态生硬，缺少层次过渡
- 边缘处理简单，无光影分离
- hover 反馈微弱

### 2.2 优化方案

#### 整体面板
```css
.sidebar {
  box-shadow: 1px 0 0 0 rgba(255,255,255,0.4) inset, 4px 0 24px rgba(0,0,0,0.04);
  position: relative;
}
.sidebar::before {
  /* 顶部白色渐变遮罩，模拟玻璃高光 */
  background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0) 100%);
}
```

#### Logo 区域
- 顶部 padding 增加：`space-6`（24px）
- 副标题 `margin-top` 从 2px 提升到 4px
- 字间距从 0.3px 提升到 0.4px

#### 导航项
- padding 从 `8px 12px` 提升到 `12px 12px`
- 行间距从 `1px` 提升到 `4px`
- 圆角从 `10px` 提升到 `14px`
- 过渡改为弹性曲线

#### Hover 态
```css
.nav-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(15, 15, 26, 0.06);
  transform: translateX(2px);        /* 微位移 */
  box-shadow: 0 2px 8px rgba(15, 15, 26, 0.04);  /* 微浮起 */
}
```

#### Active 态
```css
.nav-item.active {
  background: var(--accent);
  color: var(--text-inverse);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 12px rgba(15, 15, 26, 0.18), 0 1px 3px rgba(15, 15, 26, 0.12);
}
.nav-item.active::before {
  /* 左侧指示条 */
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--accent);
  border-radius: 0 3px 3px 0;
  opacity: 0.6;
}
```

#### 图标
- 尺寸从 20px 提升到 22px
- 增加 `color: var(--text-muted)` 默认态
- hover/active 时同步颜色过渡
- active 态添加 `filter: drop-shadow(0 0 4px rgba(255,255,255,0.3))` 微光晕

---

## 三、首页仪表盘（Dashboard）优化

### 3.1 整体布局

#### 容器限制
```css
.dashboard-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-10);  /* 32px 40px */
  gap: var(--space-6);  /* 24px */
}
```
- 避免超宽屏下内容过度拉伸
- 保持舒适阅读宽度

### 3.2 实时数据条（Realtime Ticker）

| 属性 | 优化前 | 优化后 |
|------|--------|--------|
| 圆角 | 14px | 22px |
| 内发光 | 无 | `0 0 0 1px rgba(255,255,255,0.4) inset` |
| 项间距 | 24px | 32px |
| padding | 12px 20px | 16px 24px |
| 标签字重 | 600 | 700 |
| 标签字间距 | 0.5px | 0.8px |
| 数值字重 | 600 | 700 |
| 数值字号 | 13px | 14px |
| 状态点尺寸 | 6px | 7px |
| 状态点光晕 | 6px | 8px |

### 3.3 KPI 统计面板

#### 面板容器
- 圆角：14px → 22px
- 增加内发光阴影

#### KPI 列
- padding：`20px 20px` → `24px 24px`
- 图标尺寸：40px → 44px
- 图标背景透明度：0.1 → 0.12
- 数字：26px/700 → 28px/800
- 字间距：-0.5px → -0.8px

#### 分隔线优化
```css
.ops-kpi-col:not(:last-child)::after {
  /* 从实线改为渐变，更柔和 */
  background: linear-gradient(180deg, transparent, var(--border), transparent);
  top: 25%; bottom: 25%;  /* 缩短长度 */
}
```

#### 进度条填充
- 从纯色改为渐变：`linear-gradient(90deg, var(--color), rgba(..., 0.6))`
- 增加视觉流动感

#### Hover 动效
```css
.ops-kpi-col:hover .ops-kpi-icon {
  transform: scale(1.08);  /* 图标微放大 */
}
```

#### 次要指标条
- 间距：24px → 32px
- padding：12px 20px → 16px 24px
- 字重提升，增加字间距

### 3.4 站点监控卡片

| 属性 | 优化前 | 优化后 |
|------|--------|--------|
| 圆角 | 14px | 22px |
| 内发光 | 无 | 有 |
| padding | 16px | 20px |
| 内部间距 | 12px | 16px |
| hover 位移 | 无 | `translateY(-3px)` |
| hover 阴影 | `shadow-md` | `shadow-md + inset` |
| 站点名字重 | 600 | 700 |
| 站点名字号 | 13px | 14px |
| 在线光环 | 1px/-3px | 1.5px/-4px |
| 动画周期 | 2s | 2.2s |

### 3.5 实时速度图表

- 圆角：14px → 22px
- 增加内发光 + 入场动画
- 图表高度：100px → 120px
- 柱状图圆角：2px → 3px
- 增加 `min-height: 4px` 防止数据过小时消失

### 3.6 任务活动流

- 圆角：14px → 22px
- 增加内发光 + 入场动画
- 头部 padding 增加，边框改为 `border-light`
- 活动项 padding：`8px 12px` → `12px 16px`
- 活动项圆角：10px → 14px
- hover 增加 `translateX(2px)` 滑动效果
- 最大高度：320px → 360px

### 3.7 快速链接卡片

- 图标尺寸：32px → 36px
- hover 时图标 `scale(1.08)`
- 文字字重：600 → 700
- 增加字间距：0.1px

### 3.8 输入卡片

- 过渡从 `0.15s ease` 改为 `0.25s ease`
- 增加内发光阴影
- hover 阴影同步增加内发光

---

## 四、质感提升技巧总结

### 4.1 内发光（Inset Glow）
所有主要面板统一添加：
```css
box-shadow: var(--shadow-sm), 0 0 0 1px rgba(255, 255, 255, 0.4) inset;
```
作用：模拟玻璃材质边缘受光，增加立体感。

### 4.2 渐变分隔线
KPI 列之间的分隔线从实线改为渐变：
```css
background: linear-gradient(180deg, transparent, var(--border), transparent);
```
作用：减少生硬分割，视觉过渡更自然。

### 4.3 渐变进度条
底部进度填充从纯色改为渐变：
```css
background: linear-gradient(90deg, var(--info), rgba(96, 165, 250, 0.6));
```
作用：增加流动感和现代感。

### 4.4 微位移 Hover
导航项/活动项 hover 时：
```css
transform: translateX(2px);
```
作用：提供明确的交互反馈，增强操作愉悦感。

### 4.5 浮起效果
卡片 hover 时：
```css
transform: translateY(-3px);
box-shadow: var(--shadow-md), 0 0 0 1px rgba(255,255,255,0.4) inset;
```
作用：模拟物理浮起，增强层次深度。

### 4.6 图标缩放
KPI/快速链接图标 hover 时：
```css
transform: scale(1.08);
transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
```
作用：弹性缩放比线性缩放更有生命力。

### 4.7 左侧指示条
Active 导航项左侧添加圆角竖条：
```css
width: 3px; height: 20px;
border-radius: 0 3px 3px 0;
```
作用：明确当前位置，增加设计细节。

### 4.8 光晕效果
Active 图标添加：
```css
filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.3));
```
作用：模拟发光质感，提升高级度。

---

## 五、响应式适配

### 5.1 断点 1100px
- KPI 面板：4列 → 2列
- 两栏布局：合并为单列
- 站点监控：3列 → 2列

### 5.2 断点 768px
- 页面 padding：32px 40px → 20px
- 页面间距：24px → 20px
- Ticker：允许换行
- 站点监控：单列

### 5.3 断点 480px
- KPI：2列保持
- 数值字号缩小到 22px
- Ticker 间距进一步压缩

---

## 六、检查清单

提交前确认：
- [ ] 所有卡片/面板已添加内发光阴影
- [ ] 圆角层次符合规范（sm/md/xl）
- [ ] hover 态包含微位移或缩放动效
- [ ] 过渡使用弹性曲线（bounce）而非线性
- [ ] 分隔线使用渐变而非实线
- [ ] 数值显示使用等宽字体
- [ ] 字重/字间距已按层次提升
- [ ] 响应式断点已同步调整
- [ ] 无 lint 错误

---

## 八、任务管理页（Tasks）优化

### 8.1 新增任务面板
- 工具栏背景升级为玻璃拟态卡片，增加内发光阴影
- 输入框高度从 36px 提升到 40px，圆角从 `radius-sm` 改为 `radius-lg`
- 批量导入区域增加 hover 态（边框变色 + 背景高亮）
- 整体间距从 `20px` 提升到 `24px`

### 8.2 任务列表表格
- 表头字重从 600 提升到 700，字间距从 0.3px 提升到 0.5px
- 行 hover 增加 `translateX(1px)` 微位移，提升交互反馈
- 进度条保持圆角全满，填充色按状态区分（成功/失败/进行中）

### 8.3 任务详情展开面板
- 背景增加 `backdrop-filter` 玻璃效果
- 内边距从 16px 提升到 20px
- 详情项增加 hover 态（边框高亮 + 微上移）
- 标签字重提升到 700，字间距 0.4px

---

## 九、搜索页（Search）优化

### 9.1 搜索栏重构（双层布局）

#### 问题
原搜索栏将所有元素挤在一行：输入框 + 搜索按钮 + 取消按钮 + 站点标签 + 状态信息，导致空间拥挤、视觉层次混乱。

#### 重构方案：上下双层布局

**上层（搜索操作层）**：输入框 + 动作按钮组
- 输入框独占左侧弹性空间，高度 48px，圆角 `radius-xl`
- 搜索/取消按钮组成右侧动作组，高度 44px，圆角 `radius-lg`
- 按钮增加 hover 微上浮效果（`translateY(-1px)`）

```css
.search-bar-top {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}
.search-bar-top .search-input-wrap input {
  height: 48px;
  border-radius: var(--radius-xl);
  font-size: 15px;
  padding: 12px 16px 12px 44px;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.2) inset, 0 2px 8px rgba(0,0,0,0.04);
}
.search-bar-actions .btn {
  height: 44px;
  padding: 0 20px;
  border-radius: var(--radius-lg);
}
```

**下层（信息筛选层）**：站点选择 + 任务状态
- 与上层之间用 `border-top: 1px solid var(--border-light)` 分隔
- 站点标签居左，状态徽章居右
- 状态徽章使用圆角胶囊样式，带彩色状态点

```css
.search-bar-bottom {
  display: flex;
  justify-content: space-between;
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-light);
}
.search-job-status {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-inset);
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-light);
}
.search-status-dot {
  width: 7px; height: 7px; border-radius: 50%;
}
.search-status-dot[data-status="running"] {
  background: var(--info);
  box-shadow: 0 0 6px var(--info);
  animation: pulse-glow 2s ease-in-out infinite;
}
```

#### 浮动栏整体升级
- 内边距从 `16px 32px` 提升到 `20px 32px`
- 层间距从 `12px` 提升到 `16px`
- 搜索图标从 16px 提升到 18px

### 9.2 进度条
- 轨道增加内发光阴影
- 填充使用渐变（accent → neon-cyan）
- 信息栏字重提升到 700

### 9.3 视频卡片网格
- 保持原有 hover 动效（上移 4px + 阴影扩散）
- 卡片圆角统一为 `radius-lg`

---

## 十、嗅探页（Sniff）优化

### 10.1 嗅探控制区
- 状态横幅增加内发光阴影 + 过渡动画
- 运行中状态边框使用 warning 色，背景使用 warning-soft

### 10.2 结果列表
- 每项增加玻璃拟态背景 + 内发光
- 圆角从 `radius-sm` 提升到 `radius-md`
- hover 增加 `translateX(2px)` 微位移 + 阴影扩散
- 间距从 8px 提升到 12px

---

## 十一、历史页（History）优化

### 11.1 搜索工具栏
- 升级为独立玻璃拟态卡片
- 圆角 `radius-md`，增加内发光阴影
- 与表格区域间距优化为 20px

### 11.2 表格
- 与 Tasks 页统一表头字重（700）和字间距（0.5px）
- 行 hover 增加微位移

---

## 十二、配置页（Config）优化

### 12.1 配置区块
- 每个配置节升级为独立玻璃拟态卡片
- 增加 hover 态（边框加深 + 阴影扩散）
- 内边距从 `0 20px` 提升到 `20px 24px`
- 标题字重提升到 700，增加 letter-spacing

### 12.2 搜索框
- 高度从 36px 提升到 40px
- 圆角从 `radius-sm` 提升到 `radius-md`
- 增加内发光阴影

---

## 十三、统一优化总结

| 页面 | 核心优化点 |
|------|-----------|
| Tasks | 工具栏玻璃化、表格行微位移、详情面板 hover 态 |
| Search | 搜索栏强模糊、输入框增大、进度条内发光 |
| Sniff | 结果项玻璃化、hover 微位移、状态横幅动效 |
| History | 搜索工具栏卡片化、表格统一升级 |
| Config | 配置节卡片化、搜索框增大、hover 态 |

所有页面遵循统一的设计语言：
- **玻璃拟态**：`backdrop-filter` + 内发光阴影
- **微动效**：hover 位移/缩放 + 弹性过渡曲线
- **排版升级**：字重 700+、字间距 0.2px+、等宽字体数据
- **间距呼吸**：最小 4px，区块 20-24px，页面 32-40px

---

## 十四、修订记录

| 日期 | 版本 | 修订内容 |
|------|------|---------|
| 2026-07-09 | 1.0 | 初始版本：Sidebar + Dashboard UI 优化方案 |
| 2026-07-09 | 1.1 | 新增 Tasks、Search、Sniff、History、Config 五页统一优化 |
