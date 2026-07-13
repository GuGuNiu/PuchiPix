"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Download,
  Settings,
  Radar,
  MoreHorizontal,
  ChevronLeft,
  Play,
  Images,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";

const navItems = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/tasks", label: "任务管理", icon: Download },
  { href: "/gallery", label: "图包架", icon: Images },
  { href: "/search", label: "搜索", icon: Radar },
  { href: "/config", label: "配置", icon: Settings },
];

const mobilePrimary = navItems.slice(0, 4);
const mobileSecondary = navItems.slice(4);

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [hoverExpand, setHoverExpand] = useState(false);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      window.dispatchEvent(new CustomEvent("sidebar:collapsed", { detail: next }));
      return next;
    });
    setHoverExpand(false);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!collapsed) return;
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    if (expandTimer.current) clearTimeout(expandTimer.current);
    expandTimer.current = setTimeout(() => {
      setHoverExpand(true);
      window.dispatchEvent(new CustomEvent("sidebar:hover-expand", { detail: true }));
    }, 100);
  }, [collapsed]);

  const handleMouseLeave = useCallback(() => {
    if (expandTimer.current) clearTimeout(expandTimer.current);
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      setHoverExpand(false);
      window.dispatchEvent(new CustomEvent("sidebar:hover-expand", { detail: false }));
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (expandTimer.current) clearTimeout(expandTimer.current);
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* 桌面端侧边栏 */}
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${hoverExpand ? "hover-expand" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="sidebar-header">
          <div className="sidebar-logo">PuchiPix</div>
          <div className="sidebar-logo-sub">M3U8 Downloader</div>
          <div className="sidebar-logo-collapsed">
            <Play size={22} fill="currentColor" strokeWidth={0} />
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">导航</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive(item.href) ? "active" : ""}`}
                title={collapsed && !hoverExpand ? item.label : undefined}
              >
                <span className="nav-item-icon">
                  <Icon size={18} strokeWidth={2} />
                </span>
                <span className="nav-item-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="theme-toggle-section">
          <div className="theme-toggle-divider" />
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === "light" ? "切换到夜间模式" : "切换到日间模式"}
            aria-label={theme === "light" ? "切换到夜间模式" : "切换到日间模式"}
          >
            <span className="theme-toggle-icon-wrap">
              <Sun size={18} strokeWidth={2} className="theme-toggle-icon-light" />
              <Moon size={18} strokeWidth={2} className="theme-toggle-icon-dark" />
            </span>
            <span className="theme-toggle-label">
              {theme === "light" ? "日间模式" : "夜间模式"}
            </span>
            <span className="theme-toggle-slider" />
          </button>
        </div>
        <div className="sidebar-footer">
          <span>v0.1.0</span>
        </div>
        <button
          className={`sidebar-toggle ${collapsed ? "collapsed" : ""}`}
          onClick={toggleCollapsed}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          <span className="sidebar-toggle-icon">
            <ChevronLeft size={16} strokeWidth={2.5} />
          </span>
        </button>
      </aside>

      {/* 移动端底部导航栏 */}
      <nav className="bottom-nav">
        {mobilePrimary.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-nav-item ${isActive(item.href) ? "active" : ""}`}
            >
              <Icon size={20} strokeWidth={2} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* "更多" 按钮：点击展开二级菜单 */}
        <details className="bottom-nav-more">
          <summary className="bottom-nav-item">
            <MoreHorizontal size={20} strokeWidth={2} />
            <span>更多</span>
          </summary>
          <div className="bottom-nav-more-menu">
            {mobileSecondary.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`bottom-nav-more-item ${isActive(item.href) ? "active" : ""}`}
                >
                  <Icon size={16} strokeWidth={2} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <button
              className="bottom-nav-more-item"
              onClick={toggleTheme}
            >
              {theme === "light" ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
              <span>{theme === "light" ? "夜间模式" : "日间模式"}</span>
            </button>
          </div>
        </details>
      </nav>
    </>
  );
}
