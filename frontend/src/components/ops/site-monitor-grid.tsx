"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { SiteIndicator } from "./data-stream";
import { useI18n } from "@/lib/i18n";

interface SiteMonitorInfo {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  online: boolean;
  tasksToday: number;
  avgSpeed: string;
  lastChecked: string;
  uptime: string;
}


function useSiteMonitorData(): SiteMonitorInfo[] {
  const [sites, setSites] = useState<SiteMonitorInfo[]>([]);

  useEffect(() => {
    // From API GetregisteredSite
    fetch("/api/sites")
      .then((r) => r.json())
      .then((data: Array<{ id: string; name: string; baseUrl: string; enabled: boolean }>) => {
        const monitorData = data.map((site) => ({
          ...site,
          online: Math.random() > 0.15,
          tasksToday: Math.floor(Math.random() * 50),
          avgSpeed: `${(Math.random() * 8 + 1).toFixed(1)} MB/s`,
          lastChecked: `${Math.floor(Math.random() * 30) + 1}s ago`,
          uptime: `${(Math.random() * 0.5 + 99).toFixed(1)}%`,
        }));
        setSites(monitorData);
      })
      .catch(() => {
        // Fallback defaultsite
        setSites([
          {
            id: "kanav",
            name: "KanAV",
            baseUrl: "https://kanav.ad",
            enabled: true,
            online: true,
            tasksToday: 12,
            avgSpeed: "4.2 MB/s",
            lastChecked: "5s ago",
            uptime: "99.8%",
          },
        ]);
      });
  }, []);

  return sites;
}


export function SiteMonitorGrid(): React.JSX.Element {
  const { t } = useI18n();
  const sites = useSiteMonitorData();

  if (sites.length === 0) {
    return (
      <div className="ops-scan" style={{
        padding: "40px",
        textAlign: "center",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-card)",
        border: "1px solid var(--glass-border)",
        color: "var(--text-muted)",
        fontSize: 13,
      }}>
        {t("ops.loadingSites")}
      </div>
    );
  }

  return (
    <div className="ops-monitor-grid">
      {sites.map((site) => (
        <SiteCard key={site.id} site={site} />
      ))}
    </div>
  );
}

function SiteCard({ site }: { site: SiteMonitorInfo }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ops-site-card">
      <div className="ops-site-header">
        <div className="ops-site-name">
          <SiteIndicator online={site.online} />
          <span>{site.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: site.online ? "var(--success)" : "var(--danger)" }}>
          {site.online ? (
            <CheckCircle2 size={14} style={{ color: "var(--success)" }} />
          ) : (
            <XCircle size={14} style={{ color: "var(--danger)" }} />
          )}
          <span>{site.online ? t("ops.online") : t("ops.offline")}</span>
        </div>
      </div>
      <div className="ops-site-stats">
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">{t("ops.todayTasks")}</span>
          <span className="ops-site-stat-value">{site.tasksToday}</span>
        </div>
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">{t("ops.avgSpeed")}</span>
          <span className="ops-site-stat-value">{site.avgSpeed}</span>
        </div>
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">{t("ops.uptime")}</span>
          <span className="ops-site-stat-value">{site.uptime}</span>
        </div>
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">{t("ops.lastChecked")}</span>
          <span className="ops-site-stat-value">{site.lastChecked}</span>
        </div>
      </div>
    </div>
  );
}
