# 开发日志 — 2026-07-09 — 第六轮补丁 — 搜索栏双层布局重构

## 第六轮补丁 — 搜索栏双层布局重构

### 问题背景

第五轮迭代后搜索页整体视觉提升，但顶部浮动栏内部仍显拥挤：

| 问题 | 具体表现 |
|---|---|
| 单行元素过多 | 输入框 + 搜索按钮 + 取消按钮 + 站点标签 + 状态信息全部挤在一行 |
| 按钮内联样式 | 搜索/取消按钮使用 `style={{ height: 36 }}` 硬编码，与全局 40px+ 输入框不协调 |
| 状态信息无视觉区分 | 任务状态纯文本，无徽章/状态点，难以一眼识别运行状态 |
| 站点标签与操作区混杂 | 站点选择器与搜索按钮在同一视觉层级，功能边界模糊 |

### 重构方案

采用 **上下双层布局** 重新组织搜索栏：

**上层 — 搜索操作层**：
- 输入框独占左侧，高度 48px，圆角 `radius-xl`，增加底部微阴影
- 搜索/取消按钮组成右侧动作组，高度 44px，圆角 `radius-lg`
- 按钮 hover 增加 `translateY(-1px)` 微上浮 + 阴影扩散

**下层 — 信息筛选层**：
- 与上层用 `border-top: 1px solid var(--border-light)` 分隔
- 左侧：站点选择器（pill 标签组）
- 右侧：任务状态徽章（圆角胶囊 + 彩色状态点）
- 运行中状态点增加 `pulse-glow` 呼吸动画

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/app/search/page.tsx` | 替换 `search-bar-row` + 内联 `div` 为 `search-bar-top` + `search-bar-bottom`；移除按钮内联 style；状态信息改为 `search-job-status` 徽章 + `search-status-dot` 状态点 |
| `src/app/globals.css` | 重写搜索栏样式：新增 `.search-bar-top`、`.search-bar-actions`、`.search-bar-bottom`、`.search-job-status`、`.search-status-dot`；删除 `.search-bar-row`；提升输入框高度 40px→48px，圆角 lg→xl |

### 具体代码变更

#### 结构层（page.tsx）

```tsx
// 重构前：单行混杂
<div className="search-bar-row">
  <div className="search-input-wrap">...</div>
  <button className="btn btn-primary" style={{ height: 36 }}>搜索</button>
  {isRunning && <button className="btn btn-danger" style={{ height: 36 }}>取消</button>}
</div>
<div style={{ display: "flex", justifyContent: "space-between", ... }}>
  <div className="search-site-pills">...</div>
  {job && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>状态...</div>}
</div>

// 重构后：上下双层
<div className="search-bar-top">
  <div className="search-input-wrap">...</div>
  <div className="search-bar-actions">
    <button className="btn btn-primary">搜索</button>
    {isRunning && <button className="btn btn-danger">取消</button>}
  </div>
</div>
<div className="search-bar-bottom">
  <div className="search-site-pills">...</div>
  {job && (
    <div className="search-job-status">
      <span className="search-status-dot" data-status={job.status} />
      <span>状态 · 找到 · 已爬取 · 失败</span>
    </div>
  )}
</div>
```

#### 样式层（globals.css）

```css
/* 上层：搜索操作 */
.search-bar-top {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}
.search-bar-top .search-input-wrap input {
  height: 48px;
  border-radius: var(--radius-xl);
  font-size: 15px;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.2) inset, 0 2px 8px rgba(0,0,0,0.04);
}
.search-bar-actions .btn {
  height: 44px;
  padding: 0 20px;
  border-radius: var(--radius-lg);
}
.search-bar-actions .btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md), 0 0 0 1px rgba(255,255,255,0.3) inset;
}

/* 下层：信息筛选 */
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

### 验证结果

- 搜索栏视觉层次清晰：操作层 vs 信息层分离
- 输入框 48px 高度在桌面端比例协调，圆角 xl 更大气
- 按钮 hover 微上浮动效流畅
- 状态徽章一眼可识别（running 蓝色呼吸点、completed 绿色、failed 红色）
- 站点选择器与状态信息不再拥挤在同一行
- 所有 Linter 检查通过，无错误
- 响应式断点正常适配（768px 以下自动换行）
