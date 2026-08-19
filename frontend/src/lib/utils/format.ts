/**
 * Format an ISO time string to a locale-specific time representation.
 * @param iso - ISO 8601 datetime string.
 * @param options - Formatting options.
 * @returns Formatted time string.
 */
export function formatTime(
  iso: string,
  options?: { locale?: string; showMs?: boolean },
): string {
  const { locale = 'zh-CN', showMs = true } = options ?? {};
  const d = new Date(iso);
  return d.toLocaleTimeString(locale, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(showMs ? { fractionalSecondDigits: 3 as const } : {}),
  });
}
