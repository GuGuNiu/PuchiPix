import type { BatchTitleResult } from "@/types";
import { getEnabledSiteModules, getSiteModuleName } from "@/lib/sites/site-modules";
import type { SiteModuleConfig } from "@/lib/sites/site-modules";

type SiteOption = SiteModuleConfig & { name: string; gallery: boolean };

export const getSites = (locale: string): SiteOption[] =>
  getEnabledSiteModules().map((m) => ({
    ...m,
    name: getSiteModuleName(m, locale),
    gallery: m.type === "photo",
  }));

export const getSiteOptions = (
  locale: string,
): { value: string; label: string }[] =>
  getSites(locale)
    .filter((s) => s.enabled && s.id !== "universal")
    .map((site) => ({ value: site.id, label: site.name }));

export const RESULT_STATUS_KEYS: Record<BatchTitleResult["status"], string> = {
  pending: "batchSearch.statusPending",
  searching: "batchSearch.statusSearching",
  found: "batchSearch.statusFound",
  scraping: "batchSearch.statusScraping",
  completed: "batchSearch.statusCompleted",
  not_found: "batchSearch.statusNotFound",
  failed: "batchSearch.statusFailed",
};

export const RESULT_STATUS_CLASS: Record<BatchTitleResult["status"], string> = {
  pending: "badge-default",
  searching: "badge-info",
  found: "badge-info",
  scraping: "badge-info",
  completed: "badge-success",
  not_found: "badge-warning",
  failed: "badge-danger",
};
