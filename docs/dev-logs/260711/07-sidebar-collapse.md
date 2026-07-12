# 开发日志 — 2026-07-11 — 功能六：左侧导航栏折叠交互 — Q弹动画 + hover 提前展开 + 推挤式布局

## 功能六：左侧导航栏折叠交互 — Q弹动画 + hover 提前展开 + 推挤式布局

### 背景

侧边栏此前为固定 240px 宽度，无法折叠。在小屏幕或需要更大内容区空间时，导航栏占据过多横向面积。需要实现折叠/展开交互，同时保证动画的"Q弹"质感和鼠标接近时的"提前"展开体验。

### 需求拆解

| 需求 | 说明 |
|------|------|
| 折叠/展开 | 点击 toggle 按钮切换折叠态，折叠后仅显示图标 |
| Q弹动画 | 宽度/尺寸过渡使用弹性回弹曲线 `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| hover 提前展开 | 折叠态下鼠标接近侧边栏右边缘时自动展开，鼠标离开后自动收回 |
| 内容区跟随 | 折叠/展开时右侧内容区实时跟随宽度变化 |
| 折叠态 Logo | 折叠后显示纯黑色方形播放按钮图标替代文字 Logo |
| 状态持久化 | 折叠状态通过 localStorage 保存，刷新后恢复 |
| 视觉隔离 | 增强右侧边框存在感，视觉上分隔导航栏与内容区 |

### 架构设计 — 推挤模式（非覆盖模式）

#### 方案演进

最初采用**覆盖模式**（双层结构）：外层 `.sidebar` 固定 64px 占位，内层 `.sidebar-panel` 用 `position: absolute` 展开为 240px 覆盖在内容上方。但这导致内容区（`.main-area`）的 flex 空间始终是 64px，不会跟随变化。

最终改为**推挤模式**（单层结构）：直接改变 `<aside>` 自身的 `width`，由 flexbox 自动驱动内容区收缩/扩张。

#### 推挤模式状态机

```
                    ┌─────────────────┐
                    │   expanded      │
                    │   width: 240px  │
                    │   (默认状态)     │
                    └───────┬─────────┘
                            │ click toggle
                            ▼
                    ┌─────────────────┐
                    │   collapsed     │
                    │   width: 64px   │
                    │   只显示图标     │
                    └───┬─────────┬───┘
                        │         │
              mouseenter│         │ mouseleave
            (100ms延迟) │         │ (200ms延迟)
                        ▼         │
              ┌─────────────────┐ │
              │ hover-expand    │ │
              │ width: 240px    │ │
              │ 显示完整内容     │ │
              └────────┬────────┘ │
                       │          │
              mouseleave          │
                       │          │
                       └──────────┘
                       → 回到 collapsed
```

### 实现细节

#### 6.1 CSS 变量扩展（`tokens.css`）

```css
/* 新增折叠态宽度变量 */
--sidebar-width-collapsed: 64px;
```

#### 6.2 推挤式布局（`layout.css`）

`.sidebar` 作为 `<aside>` 直接参与 flex 布局，所有视觉样式（背景、毛玻璃、边框、阴影）直接挂在 `<aside>` 上：

```css
.sidebar {
  width: var(--sidebar-width);           /* 240px */
  min-width: var(--sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  transition: width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
              min-width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sidebar.collapsed {
  width: var(--sidebar-width-collapsed); /* 64px */
  min-width: var(--sidebar-width-collapsed);
}

/* hover 展开态：宽度恢复 240px，内容区自动收缩 */
.sidebar.collapsed.hover-expand {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
}
```

#### 6.3 折叠态元素隐藏策略

各元素在折叠态（`.collapsed:not(.hover-expand)`）下的隐藏方式：

| 元素 | 隐藏方式 | 说明 |
|------|---------|------|
| `.sidebar-logo` | `display: none` | 文字 Logo 完全移除 |
| `.sidebar-logo-collapsed` | `display: flex`（反向显示） | 黑色播放图标替代 |
| `.sidebar-logo-sub` | `opacity: 0; max-height: 0` | 副标题渐隐+塌陷 |
| `.nav-section` | `opacity: 0; max-height: 0` | 分区标题渐隐+塌陷 |
| `.nav-item-label` | `display: none` | 导航文字完全移除 |
| `.sidebar-footer` | `opacity: 0` | 版本号渐隐 |

展开时使用 `transition-delay: 0.12s` 延迟出现，等面板宽度撑开后再渐入；折叠时无延迟快速消失（0.08~0.1s）。

#### 6.4 折叠态 Logo — 黑色播放按钮

```css
.sidebar-logo-collapsed {
  display: none;  /* 展开态隐藏 */
}

.sidebar.collapsed:not(.hover-expand) .sidebar-logo-collapsed {
  display: flex;
  width: 36px;
  height: 36px;
  background: #000;
  color: #fff;
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  animation: logoFadeIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes logoFadeIn {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}
```

组件中使用 lucide-react 的 `Play` 图标（`fill="currentColor"` 实心填充）。

#### 6.5 hover 提前展开机制（`sidebar.tsx`）

```
折叠态下：
├── 鼠标进入 aside → 100ms 延迟 → setHoverExpand(true) → 面板宽度变 240px
├── 鼠标离开 aside → 200ms 延迟 → setHoverExpand(false) → 面板宽度回 64px
├── 进入/离开互相清除对方的定时器，避免抖动
└── 折叠态右侧有 12px 不可见 ::after 触发区，鼠标接近即开始触发
```

延迟参数：
- 展开 100ms：避免快速划过时的误触
- 收起 200ms：给鼠标在面板内移动留出缓冲

#### 6.6 Toggle 按钮

```css
.sidebar-toggle {
  position: absolute;
  top: 50%;
  right: -13px;              /* 悬浮在右边缘外 */
  width: 26px;
  height: 26px;
  border-radius: 50%;
  z-index: 102;
}
```

- 按钮挂在 `<aside>` 上，随宽度变化自动跟随右边缘移动
- hover 时内层 icon `scale(1.18)` + 漫反射光圈
- active 时 `scale(0.85)` 按压反馈
- 折叠态 icon `rotate(180deg)` 翻转方向
- 图标变换作用于 `.sidebar-toggle-icon` 而非按钮本身，避免覆盖 `translateY(-50%)` 居中

#### 6.7 视觉隔离增强

```css
.sidebar {
  /* 边框：半透明 → 实色 */
  border-right: 1px solid var(--border-strong);  /* #cbd5e1 */

  /* 阴影：三层叠加 */
  box-shadow: 
    1px 0 0 0 rgba(255, 255, 255, 0.4) inset,   /* 内侧高光 */
    4px 0 24px rgba(0, 0, 0, 0.04),              /* 远距离弥散 */
    2px 0 12px rgba(0, 0, 0, 0.06);              /* 近距离投影 */
}

/* hover 展开态阴影加深 */
.sidebar.collapsed.hover-expand {
  box-shadow: 
    1px 0 0 0 rgba(255, 255, 255, 0.4) inset,
    4px 0 28px rgba(0, 0, 0, 0.14),
    2px 0 16px rgba(0, 0, 0, 0.1);
}
```

#### 6.8 状态持久化

```typescript
// 初始化：从 localStorage 读取
useEffect(() => {
  const saved = localStorage.getItem("sidebar-collapsed");
  if (saved === "true") setCollapsed(true);
}, []);

// 切换：同步写入
const toggleCollapsed = useCallback(() => {
  setCollapsed((prev) => {
    const next = !prev;
    localStorage.setItem("sidebar-collapsed", String(next));
    return next;
  });
  setHoverExpand(false);
}, []);
```

### 迭代修复记录

开发过程中经过多轮迭代修复：

| 轮次 | 问题 | 修复 |
|------|------|------|
| 1 | `localStorage` 只读不写，刷新后状态丢失 | `toggleCollapsed` 中同步写入 |
| 1 | 折叠按钮 hover 展开时位置不跟随 | 移除 `right: calc(...)` 计算，改用推挤模式后按钮自动跟随 |
| 1 | 导航文字在过渡中被截断 | 移除 `max-width` 动画，改用 `display: none` 彻底隐藏 |
| 2 | 覆盖模式下内容区不跟随宽度变化 | 废弃双层结构，改为推挤模式直接改 `<aside>` 宽度 |
| 2 | 折叠后文字仍可见 | `.nav-item-label` 添加 `display: none` |
| 3 | 右侧边框存在感不足 | 边框改实色 + 新增近距离投影层 |

### 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/app/styles/tokens.css` | 修改 | 新增 `--sidebar-width-collapsed: 64px` 变量 |
| `src/app/styles/layout.css` | 重写 | 推挤式布局、折叠态样式、Q弹动画、折叠态 Logo、toggle 按钮、视觉隔离增强 |
| `src/components/layout/sidebar.tsx` | 重写 | 折叠/hover 状态管理、localStorage 持久化、toggle 按钮、折叠态 Logo、tooltip |

### 验证结果

- ESLint：0 错误
- 折叠态：仅显示图标，Logo 变为黑色播放按钮
- 展开态：完整显示文字 Logo、副标题、导航标签、页脚
- hover 提前展开：鼠标接近右边缘 100ms 后展开，离开 200ms 后收回
- 内容区跟随：折叠/展开时内容区实时跟随宽度变化
- 状态持久化：刷新页面后保持折叠/展开状态

---
