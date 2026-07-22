/**
 *
 *
 * @example
 * formatDuration(3661)   // → "1h 1m"
 * formatDuration(125)    // → "2m 5s"
 * formatTime('2024-01-01T12:00:00.000Z')  // → "20:00:00.000"
 *
 * @param options - optionalconfig
 */
export function formatDuration(
  seconds: number,
  options?: { zeroText?: string },
): string {
  const { zeroText = '—' } = options ?? {};

  if (!seconds || seconds <= 0) return zeroText;

  const totalSecs = Math.round(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;

  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
  }
  return `${mins}m ${secs}s`;
}

/**
 *
 * @param options - optionalconfig
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


export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}
