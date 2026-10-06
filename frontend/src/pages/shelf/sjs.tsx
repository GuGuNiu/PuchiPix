import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { useLocation } from "react-router-dom";
import { toast } from "@/lib/i18n/toast";
import { useI18n } from "@/lib/i18n";
import { useRouteState } from "@/lib/core/infra/route-state";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import {
  Upload,
  Search as SearchIcon,
  RefreshCw,
  Trash2,
  ExternalLink,
  ImageIcon,
  Calendar,
  User,
  Inbox,
  X,
  Loader2,
  Layers,
  Tag,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface SjsCard {
  id: number;
  url: string;
  threadId: string;
  title: string;
  coverUrl: string;
  author: string;
  postDate: string;
  forumSection: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface BatchImportSummary {
  total: number;
  created: number;
  skipped: number;
  failed: number;
}

interface BatchImportResult {
  url: string;
  status: "created" | "skipped" | "failed";
  bookmark?: SjsCard;
  error?: string;
}

export default function SjsPage(): React.JSX.Element {
  const { t } = useI18n();
  const { pathname } = useLocation();
  useRouteState(pathname, { ttl: 5 * 60 * 1000, saveScroll: true });

  const { values: urlValues, update: updateUrl } = useUrlState({
    forum: "",
  });
  const [searchQuery, setSearchQuery] = useDebouncedUrlParam("q", "");

  const [cards, setCards] = useState<SjsCard[]>([]);
  const [forums, setForums] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [importResults, setImportResults] = useState<BatchImportResult[] | null>(
    null,
  );
  const [importSummary, setImportSummary] = useState<BatchImportSummary | null>(
    null,
  );
  const [urlInput, setUrlInput] = useState("");
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());

  const forumFilter = urlValues.forum;

  const setForumFilter = useCallback(
    (v: string) => updateUrl({ forum: v || null }),
    [updateUrl],
  );

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shelf/sjs");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const list: SjsCard[] = Array.isArray(data) ? data : [];
      setCards(list);
      setForums(
        [...new Set(list.map((c) => c.forumSection).filter(Boolean))],
      );
    } catch {
      toast.error("sjs.shelf.fetchFailed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cards.filter((c) => {
      if (forumFilter && c.forumSection !== forumFilter) return false;
      if (!q) return true;
      return (
        (c.title || "").toLowerCase().includes(q) ||
        (c.url || "").toLowerCase().includes(q) ||
        (c.author || "").toLowerCase().includes(q) ||
        (c.notes || "").toLowerCase().includes(q)
      );
    });
  }, [cards, forumFilter, searchQuery]);

  const urlList = useMemo(() => {
    return urlInput
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
  }, [urlInput]);

  const handleBatchImport = useCallback(async () => {
    if (urlList.length === 0) {
      toast.error("sjs.shelf.noUrlsToImport");
      return;
    }

    setImporting(true);
    setImportResults(null);
    setImportSummary(null);

    try {
      const res = await fetch("/api/shelf/sjs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlList }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error("sjs.shelf.importFailed", { error: err.error || "" });
        return;
      }

      const data = await res.json();
      setImportResults(data.results || []);
      setImportSummary(data.summary || null);

       if (data.summary?.created > 0) {
         toast.success("sjs.shelf.importSuccess", {
           created: data.summary.created,
           skipped: data.summary.skipped,
           failed: data.summary.failed,
         });
       }
       if (data.summary?.failed > 0) {
         toast.warning("sjs.shelf.importFailed", { error: `${data.summary.failed} invalid` });
       }

      await fetchCards();
    } catch {
      toast.error("sjs.shelf.importNetworkError");
    } finally {
      setImporting(false);
    }
  }, [urlList, fetchCards]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm(t("sjs.shelf.deleteConfirm"))) return;
      try {
        const res = await fetch(`/api/shelf/sjs?id=${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Delete failed");
        toast.success("sjs.shelf.deleted");
        setCards((prev) => prev.filter((c) => c.id !== id));
      } catch {
        toast.error("sjs.shelf.deleteFailed");
      }
    },
    [t],
  );

  const handleClearAll = useCallback(async () => {
    if (clearing) return;
    if (!confirm(t("sjs.shelf.clearAllConfirm"))) return;
    setClearing(true);
    try {
      const res = await fetch("/api/shelf/sjs?id=all", { method: "DELETE" });
      if (!res.ok) throw new Error("Clear failed");
      toast.success("sjs.shelf.clearedAll");
      setCards([]);
      setForums([]);
    } catch {
      toast.error("sjs.shelf.clearFailed");
    } finally {
      setClearing(false);
    }
  }, [clearing, t]);

  const handleRefreshMetadata = useCallback(
    async (id: number) => {
      setRefreshingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch("/api/shelf/sjs/bookmarks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "refresh" }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          // Backend writeError responds with {error: message}.
          toast.error("sjs.shelf.refreshFailed", { error: err.error || "" });
          return;
        }
        const data = await res.json();
        if (data.bookmark) {
          setCards((prev) =>
            prev.map((c) => (c.id === id ? data.bookmark : c)),
          );
          toast.success("sjs.shelf.refreshed");
        }
      } catch {
        toast.error("sjs.shelf.refreshNetworkError");
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  const closeModal = useCallback(() => {
    setImportModalOpen(false);
    setUrlInput("");
    setImportResults(null);
    setImportSummary(null);
  }, []);

  const toolbarStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "12px 20px",
    borderBottom: "1px solid var(--border)",
  };

  const cardStyle: CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    transition: "border-color 0.15s, box-shadow 0.15s",
    display: "flex",
    flexDirection: "column",
  };

  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <div className="tasks-toolbar" style={toolbarStyle}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setImportModalOpen(true)}
          >
            <Upload size={14} />
            {t("sjs.shelf.batchImport")}
          </button>

          <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
            <SearchIcon
              size={14}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              placeholder={t("sjs.shelf.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 12px 6px 32px",
                fontSize: 13,
                height: 32,
                boxSizing: "border-box",
                background: "var(--bg-inset)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </div>

          {forums.length > 0 && (
            <select
              value={forumFilter}
              onChange={(e) => setForumFilter(e.target.value)}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                height: 32,
                background: "var(--bg-inset)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="">{t("sjs.shelf.allForums")}</option>
              {forums.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <span
              className="pill"
              style={{ fontSize: 11, padding: "4px 10px" }}
            >
              <Layers size={11} style={{ marginRight: 4 }} />
              {cards.length}
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => fetchCards()}
            >
              <RefreshCw size={14} />
              {t("common.refresh")}
            </button>
            {cards.length > 0 && (
              <button
                className="btn btn-outline btn-sm"
                 onClick={handleClearAll}
                 disabled={clearing}
                 style={{ color: "var(--danger)" }}
              >
                <Trash2 size={14} />
                {t("sjs.shelf.clearAll")}
              </button>
            )}
          </div>
        </div>

        {loading && cards.length === 0 ? (
          <div className="loading-container">
            <div className="spinner" />
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="empty-state" style={{ minHeight: "50vh" }}>
            <div className="empty-state-icon">
              <Inbox size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">
              {cards.length === 0
                ? t("sjs.shelf.noBookmarks")
                : t("sjs.shelf.noMatchingBookmarks")}
            </div>
            <div className="empty-state-subtext">
              {cards.length === 0
                ? t("sjs.shelf.emptyHint")
                : t("sjs.shelf.emptyHintFilter")}
            </div>
            {cards.length === 0 && (
              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: 16 }}
                onClick={() => setImportModalOpen(true)}
              >
                <Upload size={14} />
                {t("sjs.shelf.batchImport")}
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
                padding: 20,
              }}
            >
              {filteredCards.map((card) => (
                <div
                  key={card.id}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: 200,
                      background: "var(--bg-inset)",
                      overflow: "hidden",
                    }}
                  >
                    {card.coverUrl ? (
                      <img
                        src={card.coverUrl}
                        alt={card.title}
                        loading="lazy"
                        decoding="async"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = "none";
                          const parent = img.parentElement;
                          if (parent && !parent.querySelector(".cover-fallback")) {
                            const fallback = document.createElement("div");
                            fallback.className = "cover-fallback";
                            fallback.style.cssText =
                              "display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);";
                            fallback.innerHTML =
                              '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                            parent.appendChild(fallback);
                          }
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: "100%",
                          color: "var(--text-muted)",
                        }}
                      >
                        <ImageIcon size={40} strokeWidth={1.5} />
                      </div>
                    )}
                    {card.forumSection && (
                      <span
                        className="pill"
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          fontSize: 10,
                          padding: "2px 8px",
                          background: "rgba(0,0,0,0.6)",
                          color: "var(--text-inverse)",
                          border: "none",
                        }}
                      >
                        <Tag size={10} style={{ marginRight: 3 }} />
                        {card.forumSection}
                      </span>
                    )}
                  </div>

                  <div style={{ padding: "10px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        lineHeight: 1.3,
                        minHeight: "2.6em",
                      }}
                      title={card.title}
                    >
                      {card.title || t("sjs.shelf.untitled")}
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text-secondary)" }}>
                      {card.author && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <User size={11} />
                          {card.author}
                        </span>
                      )}
                      {card.postDate && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <Calendar size={11} />
                          {card.postDate}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 4, marginTop: "auto", paddingTop: 8 }}>
                      <a
                        href={card.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: 11, padding: "3px 8px", flex: 1, justifyContent: "center" }}
                        title={t("sjs.shelf.openOriginal")}
                      >
                        <ExternalLink size={12} />
                      </a>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: 11, padding: "3px 8px", flex: 1, justifyContent: "center" }}
                        onClick={() => handleRefreshMetadata(card.id)}
                        disabled={refreshingIds.has(card.id)}
                        title={t("sjs.shelf.refreshMetadata")}
                      >
                        {refreshingIds.has(card.id) ? (
                          <Loader2 size={12} style={{ animation: "spin 0.6s linear infinite" }} />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          color: "var(--danger)",
                        }}
                        onClick={() => handleDelete(card.id)}
                        title={t("common.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {importModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              width: "100%",
              maxWidth: 640,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Upload size={18} />
                <span style={{ fontSize: 16, fontWeight: 600 }}>
                  {t("sjs.shelf.importTitle")}
                </span>
              </div>
              <button
                onClick={closeModal}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
              {!importResults ? (
                <>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                    {t("sjs.shelf.importDesc")}
                  </p>
                  <textarea
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder={t("sjs.shelf.importPlaceholder")}
                    disabled={importing}
                    style={{
                      width: "100%",
                      minHeight: 200,
                      padding: 12,
                      fontSize: 13,
                      fontFamily: "var(--font-mono), monospace",
                      background: "var(--bg-inset)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-primary)",
                      outline: "none",
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    <span>
                      {t("sjs.shelf.urlCount", { count: urlList.length })}
                    </span>
                    {importing && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent)" }}>
                        <Loader2 size={12} style={{ animation: "spin 0.6s linear infinite" }} />
                        {t("sjs.shelf.importing")}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {importSummary && (
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        marginBottom: 16,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: "1 1 auto", minWidth: 80, textAlign: "center", padding: "8px 12px", background: "var(--bg-inset)", borderRadius: "var(--radius-sm)" }}>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{importSummary.total}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("sjs.shelf.totalCards")}</div>
                      </div>
                      <div style={{ flex: "1 1 auto", minWidth: 80, textAlign: "center", padding: "8px 12px", background: "rgba(34,197,94,0.1)", borderRadius: "var(--radius-sm)" }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--success)" }}>{importSummary.created}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("sjs.shelf.createdCount")}</div>
                      </div>
                      <div style={{ flex: "1 1 auto", minWidth: 80, textAlign: "center", padding: "8px 12px", background: "rgba(234,179,8,0.1)", borderRadius: "var(--radius-sm)" }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--warning)" }}>{importSummary.skipped}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("sjs.shelf.skippedCount")}</div>
                      </div>
                      <div style={{ flex: "1 1 auto", minWidth: 80, textAlign: "center", padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: "var(--radius-sm)" }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--danger)" }}>{importSummary.failed}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("sjs.shelf.failedCount")}</div>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {importResults.map((r, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          padding: "8px 12px",
                          background: "var(--bg-inset)",
                          borderRadius: "var(--radius-sm)",
                          fontSize: 12,
                        }}
                      >
                        {r.status === "created" ? (
                          <CheckCircle2 size={14} style={{ color: "var(--success)", flexShrink: 0, marginTop: 2 }} />
                        ) : r.status === "skipped" ? (
                          <AlertCircle size={14} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
                        ) : (
                          <XCircle size={14} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, color: "var(--text-primary)", wordBreak: "break-all" }}>
                            {r.bookmark?.title || r.url}
                          </div>
                          {r.error && (
                            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
                              {r.error}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "12px 20px",
                borderTop: "1px solid var(--border)",
              }}
            >
              {importResults ? (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => { setImportResults(null); setImportSummary(null); setUrlInput(""); }}>
                    {t("sjs.shelf.importMore")}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={closeModal}>
                    {t("common.close")}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-outline btn-sm" onClick={closeModal} disabled={importing}>
                    {t("common.cancel")}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleBatchImport}
                    disabled={importing || urlList.length === 0}
                  >
                    {importing ? (
                      <>
                        <Loader2 size={14} style={{ animation: "spin 0.6s linear infinite" }} />
                        {t("sjs.shelf.importing")}
                      </>
                    ) : (
                      <>
                        <Upload size={14} />
                        {t("sjs.shelf.confirmImport")}
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
