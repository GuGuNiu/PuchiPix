import prisma from "@/lib/db/prisma";
import { logT } from "@/lib/i18n/server";
import { loggers } from "./logger";

const logger = loggers.seedData();

interface PrefDefault {
  key: string;
  value: string;
  category: string;
}

const PREF_DEFAULTS: PrefDefault[] = [
  { key: "ui_theme", value: "light", category: "ui" },
  { key: "ui_locale", value: "zh-CN", category: "ui" },
  { key: "ui_sidebar_collapsed", value: "false", category: "ui" },
];

interface BlocklistPreset {
  siteId: string;
  fieldType: string;
  keyword: string;
  matchMode: string;
  remark: string;
}

const BLOCKLIST_PRESETS: BlocklistPreset[] = [
  { siteId: "aimeizizi", fieldType: "title", keyword: "AI Nudes", matchMode: "includes", remark: "AI 生成内容过滤" },
  { siteId: "aimeizizi", fieldType: "title", keyword: "AI Porn", matchMode: "includes", remark: "AI 生成内容过滤" },
  { siteId: "aimeizizi", fieldType: "title", keyword: "AI 生成", matchMode: "includes", remark: "AI 生成内容过滤" },
  { siteId: "aimeizizi", fieldType: "title", keyword: "AI生成", matchMode: "includes", remark: "AI 生成内容过滤" },
  { siteId: "aimeizizi", fieldType: "title", keyword: "人工智能生成", matchMode: "includes", remark: "AI 生成内容过滤" },
  { siteId: "aimeizizi", fieldType: "title", keyword: "AI绘图", matchMode: "includes", remark: "AI 生成内容过滤" },
  { siteId: "aimeizizi", fieldType: "title", keyword: "AI 绘图", matchMode: "includes", remark: "AI 生成内容过滤" },

  { siteId: "aimeizizi", fieldType: "category", keyword: "AI美女", matchMode: "includes", remark: "AI 生成分类过滤" },
  { siteId: "aimeizizi", fieldType: "category", keyword: "AI 美女", matchMode: "includes", remark: "AI 生成分类过滤" },
  { siteId: "aimeizizi", fieldType: "category", keyword: "AI生成", matchMode: "includes", remark: "AI 生成分类过滤" },

  { siteId: "all", fieldType: "title", keyword: "广告推广", matchMode: "includes", remark: "广告内容过滤" },
  { siteId: "all", fieldType: "title", keyword: "加微信", matchMode: "includes", remark: "广告内容过滤" },
  { siteId: "all", fieldType: "title", keyword: "加Q群", matchMode: "includes", remark: "广告内容过滤" },
  { siteId: "all", fieldType: "title", keyword: "出售资源", matchMode: "includes", remark: "广告内容过滤" },
];


export async function seedPresetData(): Promise<void> {
  let prefSeeded = 0;
  let blSeeded = 0;

  try {
    const existingPrefs = await prisma.userPreference.findMany({
      where: { key: { in: PREF_DEFAULTS.map((p) => p.key) } },
      select: { key: true },
    });
    const existingKeys = new Set(existingPrefs.map((p) => p.key));
    const missing = PREF_DEFAULTS.filter((p) => !existingKeys.has(p.key));

    if (missing.length > 0) {
      await Promise.all(
        missing.map((p) =>
          prisma.userPreference.upsert({
            where: { key: p.key },
            create: { key: p.key, value: p.value, category: p.category },
            update: {},
          }),
        ),
      );
      prefSeeded = missing.length;
    }
  } catch (err) {
    logger.error('User preference seed failed', { error: err instanceof Error ? err.message : String(err) });
  }

  try {
    const existingRules = await prisma.blocklistRule.findMany({
      where: {
        OR: BLOCKLIST_PRESETS.map((p) => ({
          siteId: p.siteId,
          fieldType: p.fieldType,
          keyword: p.keyword,
        })),
      },
      select: { siteId: true, fieldType: true, keyword: true },
    });
    const existingSet = new Set(existingRules.map((r) => `${r.siteId}|${r.fieldType}|${r.keyword}`));
    const missingRules = BLOCKLIST_PRESETS.filter(
      (p) => !existingSet.has(`${p.siteId}|${p.fieldType}|${p.keyword}`),
    );

    if (missingRules.length > 0) {
      await Promise.all(
        missingRules.map((p) =>
          prisma.blocklistRule.create({
            data: {
              siteId: p.siteId,
              fieldType: p.fieldType,
              keyword: p.keyword,
              matchMode: p.matchMode,
              remark: p.remark,
            },
          }),
        ),
      );
      blSeeded = missingRules.length;
    }
  } catch (err) {
    logger.error('Blocklist seed failed', { error: err instanceof Error ? err.message : String(err) });
  }

  if (prefSeeded > 0 || blSeeded > 0) {
    logger.infoT("log.seed.presetDataSeeded", { prefs: prefSeeded, blocklists: blSeeded });
  }
}
