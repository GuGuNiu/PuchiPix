"use client";

import packageInfo from "../../../package.json";

const APP_VERSION = packageInfo.version;

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Home,
  Download,
  Settings,
  Bug,
  MoreHorizontal,
  ChevronLeft,
  Play,
  GalleryHorizontal,
  Sun,
  Moon,
  ShieldBan,
} from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { useI18n } from "@/lib/i18n";
import { useSidebarCollapsed, useSidebarToggle } from "@/hooks/use-sidebar-collapsed";
import CyberpunkCityBg from "./cyberpunk-city-bg";
import LanguageSwitcher from "./language-switcher";

const navItems = [
  { href: "/", labelKey: "nav.dashboard", icon: Home },
  { href: "/tasks", labelKey: "nav.tasks", icon: Download },
  { href: "/search", labelKey: "nav.search", icon: Bug },
  { href: "/gallery", labelKey: "nav.gallery", icon: GalleryHorizontal },
  { href: "/blocklist", labelKey: "nav.blocklist", icon: ShieldBan },
  { href: "/config", labelKey: "nav.config", icon: Settings },
];

const mobilePrimary = navItems.slice(0, 4);
const mobileSecondary = navItems.slice(4);

export default function Sidebar(): React.JSX.Element {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const collapsed = useSidebarCollapsed();
  const { toggle: toggleCollapsed } = useSidebarToggle();
  const [hoverExpand, setHoverExpand] = useState(false);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${hoverExpand ? "hover-expand" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <CyberpunkCityBg />
        <div className="sidebar-header">
          <div className="sidebar-logo">PuchiPix</div>
          <div className="sidebar-logo-row">
            <div className="sidebar-logo-sub">{t("nav.logoSub")}</div>
            <div className="sidebar-version-divider" />
            <div className="sidebar-version">v{APP_VERSION}</div>
          </div>
          <div className="sidebar-logo-collapsed">
            <Play size={22} fill="currentColor" strokeWidth={0} />
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">{t("nav.navigation")}</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const label = t(item.labelKey);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive(item.href) ? "active" : ""}`}
                title={collapsed && !hoverExpand ? label : undefined}
              >
                <span className="nav-item-icon">
                  <Icon size={18} strokeWidth={2} />
                </span>
                <span className="nav-item-label">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="theme-toggle-divider" />
        <LanguageSwitcher />
        <div className="theme-toggle-section">
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === "light" ? t("nav.switchToDark") : t("nav.switchToLight")}
            aria-label={theme === "light" ? t("nav.switchToDark") : t("nav.switchToLight")}
          >
            <span className="theme-toggle-icon-wrap">
              <Sun size={18} strokeWidth={2} className="theme-toggle-icon-light" />
              <Moon size={18} strokeWidth={2} className="theme-toggle-icon-dark" />
            </span>
            <span className="theme-toggle-label">
              {theme === "light" ? t("nav.lightMode") : t("nav.darkMode")}
            </span>
            <span className="theme-toggle-slider" />
          </button>
        </div>
        <button
          className={`sidebar-toggle ${collapsed ? "collapsed" : ""}`}
          onClick={toggleCollapsed}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
        >
          <span className="sidebar-toggle-icon">
            <ChevronLeft size={16} strokeWidth={2.5} />
          </span>
        </button>
      </aside>

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
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}

        <details className="bottom-nav-more">
          <summary className="bottom-nav-item">
            <MoreHorizontal size={20} strokeWidth={2} />
            <span>{t("common.more")}</span>
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
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            })}
            <button
              className="bottom-nav-more-item"
              onClick={toggleTheme}
            >
              {theme === "light" ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
              <span>{theme === "light" ? t("nav.darkMode") : t("nav.lightMode")}</span>
            </button>
          </div>
        </details>
      </nav>
    </>
  );
}
