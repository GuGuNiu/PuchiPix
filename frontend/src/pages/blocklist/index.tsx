import { useEffect, useState, useCallback } from "react";
import { toast } from "@/lib/i18n/toast";
import { useI18n } from "@/lib/i18n";
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

export default function BlocklistPage(): React.JSX.Element {
  const { t } = useI18n();
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

  const fieldTypes = [
    { value: "title", label: t("blocklist.fieldTitle") },
    { value: "category", label: t("blocklist.fieldCategory") },
    { value: "protagonist", label: t("blocklist.fieldPerson") },
    { value: "director", label: t("blocklist.fieldDirector") },
  ];

  const matchModes = [
    { value: "includes", label: t("blocklist.modeIncludes") },
    { value: "exact", label: t("blocklist.modeExact") },
    { value: "regex", label: t("blocklist.modeRegex") },
  ];

  const siteOptions = [
    { value: "all", label: t("blocklist.scopeAll") },
    { value: "aimeizizi", label: t("blocklist.scopeAimeizizi") },
    { value: "kanav", label: t("blocklist.scopeKanav") },
    { value: "exhentai", label: t("blocklist.scopeExhentai") },
    { value: "sjs", label: t("blocklist.scopeSjs") },
  ];

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/blocklist");
      const data = await res.json();
      setRules(data.data || []);
    } catch {
      toast.error("blocklist.loadFailed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleAdd = async (): Promise<void> => {
    if (!newRule.keyword.trim()) {
      toast.error("blocklist.pleaseInputKeyword");
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
        throw new Error(data.error || t("blocklist.addFailed"));
      }
      toast.success("blocklist.addSuccess");
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
      if (!res.ok) throw new Error(t("blocklist.toggleFailed"));
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
      if (!res.ok) throw new Error(t("blocklist.deleteFailed"));
      toast.success("common.deleted");
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    const selectedIds = selectedIdsSet;
    if (selectedIds.size === 0) {
      toast.error("blocklist.pleaseSelectRules");
      return;
    }
    const ids = Array.from(selectedIds).join(",");
    try {
      const res = await fetch(`/api/blocklist?ids=${ids}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("blocklist.deleteFailed"));
      toast.success("blocklist.deleted", { count: selectedIds.size });
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
    fieldTypes.find((f) => f.value === ft)?.label ?? ft;

  const matchModeLabel = (mm: string): string =>
    matchModes.find((m) => m.value === mm)?.label ?? mm;

  const siteLabel = (sid: string): string =>
    siteOptions.find((s) => s.value === sid)?.label ?? sid;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t("blocklist.title")}</h1>
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
              {siteOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              {t("blocklist.totalCount", { count: filteredRules.length })}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedIdsSet.size > 0 && (
              <button className="btn btn-danger" onClick={handleBatchDelete}>
                <Trash2 size={16} />
                {t("blocklist.deleteSelected", { count: selectedIdsSet.size })}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
              <Plus size={16} />
              {t("blocklist.addRule")}
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
                <label>{t("blocklist.colSite")}</label>
                <select
                  className="form-select"
                  value={newRule.siteId}
                  onChange={(e) => setNewRule({ ...newRule, siteId: e.target.value })}
                >
                  {siteOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: "0 0 auto" }}>
                <label>{t("blocklist.colField")}</label>
                <select
                  className="form-select"
                  value={newRule.fieldType}
                  onChange={(e) => setNewRule({ ...newRule, fieldType: e.target.value })}
                >
                  {fieldTypes.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: "0 0 auto" }}>
                <label>{t("blocklist.colMatchMode")}</label>
                <select
                  className="form-select"
                  value={newRule.matchMode}
                  onChange={(e) => setNewRule({ ...newRule, matchMode: e.target.value })}
                >
                  {matchModes.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
                <label>{t("blocklist.colKeyword")}</label>
                <input
                  type="text"
                  placeholder={t("blocklist.placeholderKeyword")}
                  value={newRule.keyword}
                  onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                <label>{t("common.remark")}</label>
                <input
                  type="text"
                  placeholder={t("common.remarkOptional")}
                  value={newRule.remark}
                  onChange={(e) => setNewRule({ ...newRule, remark: e.target.value })}
                />
              </div>
              <button className="btn btn-primary" onClick={handleAdd}>
                {t("blocklist.confirmAdd")}
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
            {t("blocklist.noRules")}
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
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>{t("blocklist.colSite")}</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>{t("blocklist.colField")}</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>{t("blocklist.colKeyword")}</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>{t("blocklist.colMatchMode")}</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>{t("common.remark")}</th>
                  <th style={{ padding: "8px 12px", textAlign: "center" }}>{t("blocklist.colStatus")}</th>
                  <th style={{ padding: "8px 12px", textAlign: "center" }}>{t("blocklist.colActions")}</th>
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
                        title={rule.enabled ? t("blocklist.clickToDisable") : t("blocklist.clickToEnable")}
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
                        title={t("common.delete")}
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
