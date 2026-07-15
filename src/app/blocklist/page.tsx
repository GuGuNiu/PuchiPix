"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Ban, Check, Filter } from "lucide-react";

interface BlocklistRule {
  id: number;
  siteId: string;
  fieldType: string;
  keyword: string;
  matchMode: string;
  enabled: boolean;
  remark: string;
  createdAt: string;
}

const FIELD_TYPES = [
  { value: "title", label: "标题" },
  { value: "category", label: "分类" },
  { value: "protagonist", label: "主角" },
  { value: "director", label: "导演" },
] as const;

const MATCH_MODES = [
  { value: "includes", label: "包含" },
  { value: "exact", label: "精确" },
  { value: "regex", label: "正则" },
] as const;

const SITE_OPTIONS = [
  { value: "all", label: "全局" },
  { value: "aimeizizi", label: "爱妹子" },
  { value: "kanav", label: "KanAV" },
  { value: "exhentai", label: "E-Hentai" },
  { value: "sjs", label: "司机社" },
] as const;

export default function BlocklistPage(): React.JSX.Element {
  const [rules, setRules] = useState<BlocklistRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSite, setFilterSite] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRule, setNewRule] = useState({
    siteId: "all",
    fieldType: "title",
    keyword: "",
    matchMode: "includes",
    remark: "",
  });

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/blocklist");
      const data = await res.json();
      setRules(data.data || []);
    } catch {
      toast.error("加载屏蔽规则失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleAdd = async (): Promise<void> => {
    if (!newRule.keyword.trim()) {
      toast.error("请输入屏蔽关键词");
      return;
    }

    try {
      const res = await fetch("/api/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRule),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "添加失败");
      }
      toast.success("规则已添加");
      setNewRule({
        siteId: "all",
        fieldType: "title",
        keyword: "",
        matchMode: "includes",
        remark: "",
      });
      setShowAddForm(false);
      fetchRules();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleToggle = async (rule: BlocklistRule): Promise<void> => {
    try {
      const res = await fetch("/api/blocklist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error("更新失败");
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    try {
      const res = await fetch(`/api/blocklist?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("已删除");
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    const selectedIds = selectedIdsSet;
    if (selectedIds.size === 0) {
      toast.error("请先选择要删除的规则");
      return;
    }
    const ids = Array.from(selectedIds).join(",");
    try {
      const res = await fetch(`/api/blocklist?ids=${ids}`, { method: "DELETE" });
      if (!res.ok) throw new Error("批量删除失败");
      toast.success(`已删除 ${selectedIds.size} 条规则`);
      setSelectedIdsSet(new Set());
      fetchRules();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const [selectedIdsSet, setSelectedIdsSet] = useState<Set<number>>(new Set());

  const toggleSelect = (id: number): void => {
    setSelectedIdsSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredRules = rules.filter((r) => {
    if (filterSite === "all") return true;
    return r.siteId === filterSite || r.siteId === "all";
  });

  const fieldTypeLabel = (ft: string): string =>
    FIELD_TYPES.find((f) => f.value === ft)?.label ?? ft;

  const matchModeLabel = (mm: string): string =>
    MATCH_MODES.find((m) => m.value === mm)?.label ?? mm;

  const siteLabel = (sid: string): string =>
    SITE_OPTIONS.find((s) => s.value === sid)?.label ?? sid;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>屏蔽词库</h1>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={16} />
            <select
              className="form-select"
              value={filterSite}
              onChange={(e) => setFilterSite(e.target.value)}
              style={{ minWidth: 120 }}
            >
              {SITE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              共 {filteredRules.length} 条规则
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedIdsSet.size > 0 && (
              <button className="btn btn-danger" onClick={handleBatchDelete}>
                <Trash2 size={16} />
                删除选中 ({selectedIdsSet.size})
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
              <Plus size={16} />
              添加规则
            </button>
          </div>
        </div>

        {showAddForm && (
          <div style={{
            marginBottom: 16,
            padding: 16,
            border: "1px solid var(--border-color)",
            borderRadius: 8,
            background: "var(--bg-secondary)",
          }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="form-group" style={{ flex: "0 0 auto" }}>
                <label>站点</label>
                <select
                  className="form-select"
                  value={newRule.siteId}
                  onChange={(e) => setNewRule({ ...newRule, siteId: e.target.value })}
                >
                  {SITE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: "0 0 auto" }}>
                <label>字段</label>
                <select
                  className="form-select"
                  value={newRule.fieldType}
                  onChange={(e) => setNewRule({ ...newRule, fieldType: e.target.value })}
                >
                  {FIELD_TYPES.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: "0 0 auto" }}>
                <label>匹配模式</label>
                <select
                  className="form-select"
                  value={newRule.matchMode}
                  onChange={(e) => setNewRule({ ...newRule, matchMode: e.target.value })}
                >
                  {MATCH_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
                <label>关键词</label>
                <input
                  type="text"
                  placeholder="输入屏蔽关键词"
                  value={newRule.keyword}
                  onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                <label>备注</label>
                <input
                  type="text"
                  placeholder="可选备注"
                  value={newRule.remark}
                  onChange={(e) => setNewRule({ ...newRule, remark: e.target.value })}
                />
              </div>
              <button className="btn btn-primary" onClick={handleAdd}>
                确认添加
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="loading-container">
            <div className="spinner" />
          </div>
        ) : filteredRules.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary)" }}>
            暂无屏蔽规则，点击"添加规则"创建
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border-color)" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left", width: 40 }}>
                    <input
                      type="checkbox"
                      checked={filteredRules.length > 0 && filteredRules.every((r) => selectedIdsSet.has(r.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIdsSet(new Set(filteredRules.map((r) => r.id)));
                        } else {
                          setSelectedIdsSet(new Set());
                        }
                      }}
                    />
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>站点</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>字段</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>关键词</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>匹配模式</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>备注</th>
                  <th style={{ padding: "8px 12px", textAlign: "center" }}>状态</th>
                  <th style={{ padding: "8px 12px", textAlign: "center" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map((rule) => (
                  <tr
                    key={rule.id}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      opacity: rule.enabled ? 1 : 0.5,
                    }}
                  >
                    <td style={{ padding: "8px 12px" }}>
                      <input
                        type="checkbox"
                        checked={selectedIdsSet.has(rule.id)}
                        onChange={() => toggleSelect(rule.id)}
                      />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span className="badge" style={{
                        background: rule.siteId === "all"
                          ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                          : "var(--bg-tertiary)",
                        color: rule.siteId === "all" ? "#fff" : "var(--text-primary)",
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}>
                        {siteLabel(rule.siteId)}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px" }}>{fieldTypeLabel(rule.fieldType)}</td>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{rule.keyword}</td>
                    <td style={{ padding: "8px 12px" }}>{matchModeLabel(rule.matchMode)}</td>
                    <td style={{ padding: "8px 12px", color: "var(--text-secondary)" }}>{rule.remark || "-"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <button
                        onClick={() => handleToggle(rule)}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: rule.enabled ? "var(--success-color, #10b981)" : "var(--text-secondary)",
                        }}
                        title={rule.enabled ? "点击禁用" : "点击启用"}
                      >
                        {rule.enabled ? <Check size={18} /> : <Ban size={18} />}
                      </button>
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: "var(--danger-color, #ef4444)",
                        }}
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
