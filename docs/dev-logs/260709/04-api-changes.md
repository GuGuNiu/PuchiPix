# 开发日志 — 2026-07-09 — API 变更

## API 变更

### 新增端点

#### `GET /api/sites`

返回所有已注册站点信息，供前端展示站点选择器。

**响应示例**：

```json
[
  {
    "id": "kanav",
    "name": "KanAV",
    "baseUrl": "https://kanav.ad",
    "enabled": true
  }
]
```

### 变更端点

#### `POST /api/search`

请求体新增可选字段 `siteId`：

```json
{
  "keywords": "女仆, 天使",
  "siteId": "kanav"
}
```

如未指定 `siteId`，默认使用 `kanav`。

---
