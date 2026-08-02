import packageInfo from "../../../package.json";

const APP_VERSION = packageInfo.version;

import { Link, useLocation } from "react-router-dom";
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
  ChevronDown,
  ImageIcon,
  Truck,
  SlidersHorizontal,
} from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { useI18n } from "@/lib/i18n";
import { useSidebarCollapsed, useSidebarToggle } from "@/hooks/use-sidebar-collapsed";
import CyberpunkCityBg from "./cyberpunk-city-bg";
import LanguageSwitcher from "./language-switcher";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

interface NavGroup {
  labelKey: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const isNavGroup = (entry: NavEntry): entry is NavGroup => "items" in entry;

const navItems: NavEntry[] = [
  { href: "/", labelKey: "nav.dashboard", icon: Home },
  { href: "/tasks", labelKey: "nav.tasks", icon: Download },
  { href: "/search", labelKey: "nav.search", icon: Bug },
  {
    labelKey: "nav.shelf",
    icon: GalleryHorizontal,
    items: [
      { href: "/shelf/photos", labelKey: "nav.photos", icon: ImageIcon },
      { href: "/shelf/sjs", labelKey: "nav.sjs", icon: Truck },
    ],
  },
  {
    labelKey: "nav.config",
    icon: Settings,
    items: [
      { href: "/config", labelKey: "nav.configGeneral", icon: SlidersHorizontal },
      { href: "/blocklist", labelKey: "nav.blocklist", icon: ShieldBan },
    ],
  },
];

const allNavItems: NavItem[] = navItems.flatMap((entry) =>
  isNavGroup(entry) ? entry.items : [entry]
);
const mobilePrimary = allNavItems.slice(0, 4);
const mobileSecondary = allNavItems.slice(4);

interface NavGroupItemProps {
  group: NavGroup;
  isActive: (href: string) => boolean;
  isOpen: boolean;
  onToggle: () => void;
  collapsed: boolean;
  hoverExpand: boolean;
}

function NavGroupItem({ group, isActive, isOpen, onToggle, collapsed, hoverExpand }: NavGroupItemProps): React.JSX.Element {
  const { t } = useI18n();
  const groupActive = group.items.some((item) => isActive(item.href));
  const Icon = group.icon;
  const label = t(group.labelKey);

  return (
    <div className={`nav-group ${groupActive ? "active" : ""} ${isOpen ? "open" : ""}`}>
      <button
        className="nav-item nav-group-trigger"
        onClick={onToggle}
        title={collapsed && !hoverExpand ? label : undefined}
      >
        <span className="nav-item-icon">
          <Icon size={18} strokeWidth={2} />
        </span>
        <span className="nav-item-label">{label}</span>
        <span className="nav-group-chevron">
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </button>
      <div className="nav-group-items">
        {group.items.map((item) => {
          const ItemIcon = item.icon;
          const itemLabel = t(item.labelKey);
          return (
            <Link 
              key={item.href}
              to={item.href}
              className={`nav-item nav-sub-item ${isActive(item.href) ? "active" : ""}`}
              title={collapsed && !hoverExpand ? itemLabel : undefined}
            >
              <span className="nav-item-icon">
                <ItemIcon size={16} strokeWidth={2} />
              </span>
              <span className="nav-item-label">{itemLabel}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function Sidebar(): React.JSX.Element {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const collapsed = useSidebarCollapsed();
  const { toggle: toggleCollapsed } = useSidebarToggle();
  const [hoverExpand, setHoverExpand] = useState(false);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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

  const isActive = useCallback(
    (href: string): boolean =>
      href === "/" ? pathname === "/" : pathname.startsWith(href),
    [pathname]
  );

  const toggleGroup = useCallback((labelKey: string) => {
    setOpenGroups((prev) => ({ ...prev, [labelKey]: !prev[labelKey] }));
  }, []);

  // Auto-expand group if any of its children is active
  useEffect(() => {
    navItems.forEach((entry) => {
      if (isNavGroup(entry)) {
        const hasActiveChild = entry.items.some((item) => isActive(item.href));
        if (hasActiveChild) {
          setOpenGroups((prev) => ({ ...prev, [entry.labelKey]: true }));
        }
      }
    });
  }, [pathname, isActive]);

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
          {navItems.map((entry) => {
            if (isNavGroup(entry)) {
              return (
                <NavGroupItem
                  key={entry.labelKey}
                  group={entry}
                  isActive={isActive}
                  isOpen={!!openGroups[entry.labelKey]}
                  onToggle={() => toggleGroup(entry.labelKey)}
                  collapsed={collapsed}
                  hoverExpand={hoverExpand}
                />
              );
            }
            const Icon = entry.icon;
            const label = t(entry.labelKey);
            return (
              <Link
                key={entry.href}
                to={entry.href}
                className={`nav-item ${isActive(entry.href) ? "active" : ""}`}
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
              to={item.href}
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
                  to={item.href}
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
