"use client";

import { useEffect, useState } from "react";
import { Globe, CheckCircle2, XCircle, Clock, HardDrive, Wifi } from "lucide-react";
import { SiteIndicator } from "./data-stream";

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

/**
 * 模拟获取站点监控数据
 *
 * 实际生产环境中应通过 API 获取真实的站点健康状态。
 * 这里使用模拟数据展示 Ops 面板风格。
 */
function useSiteMonitorData(): SiteMonitorInfo[] {
  const [sites, setSites] = useState<SiteMonitorInfo[]>([]);

  useEffect(() => {
    // 从 API 获取已注册站点
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
        // fallback 默认站点
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

/**
 * 站点监控网格组件
 *
 * 展示所有已注册站点的实时健康状态、任务数、速度等关键指标。
 * 每个站点卡片包含：在线状态指示灯、任务数统计、速度、最后检查时间。
 */
export function SiteMonitorGrid() {
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
        正在加载站点监控数据...
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

function SiteCard({ site }: { site: SiteMonitorInfo }) {
  return (
    <div className="ops-site-card">
      <div className="ops-site-header">
        <div className="ops-site-name">
          <SiteIndicator online={site.online} />
          <span>{site.name}</span>
        </div>
        {site.online ? (
          <CheckCircle2 size={14} style={{ color: "var(--success)" }} />
        ) : (
          <XCircle size={14} style={{ color: "var(--danger)" }} />
        )}
      </div>
      <div className="ops-site-stats">
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">今日任务</span>
          <span className="ops-site-stat-value">{site.tasksToday}</span>
        </div>
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">平均速度</span>
          <span className="ops-site-stat-value">{site.avgSpeed}</span>
        </div>
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">可用性</span>
          <span className="ops-site-stat-value">{site.uptime}</span>
        </div>
        <div className="ops-site-stat">
          <span className="ops-site-stat-label">最后检查</span>
          <span className="ops-site-stat-value">{site.lastChecked}</span>
        </div>
      </div>
    </div>
  );
}
