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
