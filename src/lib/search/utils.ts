export const MAX_RESULTS_PER_KEYWORD = 50;
export const MAX_PAGES_PER_KEYWORD = 5;

export const BATCH_MAX_PAGES = 2;
export const MATCH_THRESHOLD = 0.6;


export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_·:;.,。!?【】\[\]()"'<>《》/|]+/g, '')
    .trim();
}


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
