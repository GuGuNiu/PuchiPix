import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Search as SearchIcon,
  Loader2,
  Inbox,
  ImageIcon,
  User,
  Tag,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getSiteModule } from "@/lib/site-modules";

interface SearchResult {
  id: number;
  title: string;
  protagonist: string;
  tags: string;
  coverUrl: string;
  siteId: string;
  imageCount: number;
  status: string;
}

export default function SearchPage(): React.JSX.Element {
  const { t } = useI18n();
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setKeywords(q);
  }, []);

  const handleSearch = useCallback(async (): Promise<void> => {
    const raw = keywords.trim();
    if (!raw) {
      toast.error(t("search.pleaseInputKeyword"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: raw }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data: unknown = await res.json();
      setResults(Array.isArray(data) ? (data as SearchResult[]) : []);
      setSearched(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [keywords, t]);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="search-page">
      <div className="search-floating-bar">
        <div className="search-bar-top">
          <div className="search-input-wrap">
            <SearchIcon size={16} className="search-input-icon" />
            <input
              type="text"
              placeholder={t("search.placeholderGallery")}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="search-bar-actions">
            <button
              className="btn btn-primary"
              onClick={handleSearch}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="spinner spinner-sm" />
                  {t("search.searching")}
                </>
              ) : (
                <>
                  <SearchIcon size={14} />
                  {t("search.startSearch")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="search-gallery">
        {loading ? (
          <div className="search-gallery-empty">
            <Loader2 size={48} className="spinner" style={{ opacity: 0.3, marginBottom: 16 }} />
            <div style={{ fontSize: 15, fontWeight: 500 }}>
              {t("search.loadingData")}
            </div>
          </div>
        ) : results.length > 0 ? (
          <>
            <div className="search-results-bar">
              <span className="search-results-info">
                {t("search.totalResultsGallery", { count: results.length })}
              </span>
            </div>
            <div className="search-gallery-grid">
              {results.map((item) => {
                const site = getSiteModule(item.siteId);
                return (
                  <a
                    key={item.id}
                    href={`/shelf/photos?id=${item.id}`}
                    className="search-result-card"
                    style={{
                      display: "block",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      overflow: "hidden",
                      textDecoration: "none",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        height: 180,
                        background: "var(--bg-inset)",
                        overflow: "hidden",
                      }}
                    >
                      {item.coverUrl ? (
                        <img
                          src={`/api/shelf/${item.id}?type=cover`}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (!img.dataset.fallback) {
                              img.dataset.fallback = "1";
                              img.src = item.coverUrl;
                            } else {
                              img.style.display = "none";
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
                      {site && (
                        <span
                          className="badge"
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            fontSize: 10,
                            background: site.badge.gradient,
                            color: site.badge.textColor,
                          }}
                        >
                          {site.nameCn}
                        </span>
                      )}
                    </div>
                    <div style={{ padding: "8px 12px" }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginBottom: 4,
                        }}
                        title={item.title}
                      >
                        {item.title || `#${item.id}`}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          flexWrap: "wrap",
                        }}
                      >
                        {item.protagonist && (
                          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <User size={10} />
                            {item.protagonist}
                          </span>
                        )}
                        {item.imageCount > 0 && (
                          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <ImageIcon size={10} />
                            {item.imageCount}P
                          </span>
                        )}
                        {item.tags && (
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: "100%",
                            }}
                            title={item.tags}
                          >
                            <Tag size={10} />
                            {item.tags}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        ) : (
          <div className="search-gallery-empty">
            <Inbox size={48} strokeWidth={1.5} style={{ opacity: 0.3, marginBottom: 16 }} />
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
              {searched ? t("search.emptyGallery") : t("search.resultsAsCards")}
            </div>
            <div style={{ fontSize: 13 }}>
              {searched ? t("search.noDetailData") : t("search.placeholderGallery")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
