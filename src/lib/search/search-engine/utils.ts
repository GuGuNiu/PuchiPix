export const MAX_RESULTS_PER_KEYWORD = 50;
/** 每个关键词最多翻页数 */
export const MAX_PAGES_PER_KEYWORD = 5;

/** 批量搜索时每个标题最多翻页数（降低以提升整体速度） */
export const BATCH_MAX_PAGES = 2;
/** 批量搜索模糊匹配阈值（低于此分数视为未找到） */
export const MATCH_THRESHOLD = 0.6;

/**
 * 规范化标题：去除空格、标点、特殊字符，转小写
 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_·：:；;.,，。！!？?【】\[\]（）()（）"'<>《》/|]+/g, '')
    .trim();
}

/**
 * 计算两个标题的相似度分数（0-1）
 *
 * 策略：
 * - 两个标题完全相同 → 1.0
 * - 一个包含另一个 → 0.85 × (较短长度/较长长度)
 * - 否则使用字符重叠率
 */
export function titleSimilarity(input: string, candidate: string): number {
  const a = normalizeTitle(input);
  const b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1.0;

  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return 0.85 * (shorter / longer);
  }

  const setB = new Set(b);
  let common = 0;
  for (const ch of a) {
    if (setB.has(ch)) common++;
  }
  return common / Math.max(a.length, b.length);
}
