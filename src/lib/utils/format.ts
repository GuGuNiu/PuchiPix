/**
 * 格式化工具模块
 *
 * 提供时长、时间、数字等格式化功能。
 *
 * @example
 * formatDuration(3661)   // → "1h 1m"
 * formatDuration(125)    // → "2m 5s"
 * formatTime('2024-01-01T12:00:00.000Z')  // → "20:00:00.000"
 *
 * @param seconds - 秒数
 * @param options - 可选配置
 * @param options.zeroText - 当秒数为 0 或负数时的显示文本（默认 '—'）
 * @returns 格式化后的时长字符串
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
 * 格式化 ISO 时间字符串为本地时间
 *
 * @param iso - ISO 8601 时间字符串
 * @param options - 可选配置
 * @param options.locale - 地区（默认 'zh-CN'）
 * @param options.showMs - 是否显示毫秒（默认 true）
 * @returns 格式化后的时间字符串
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

/**
 * 格式化日期为 YYYY-MM-DD 格式
 *
 * @param date - 日期对象或 ISO 字符串
 * @returns 格式化后的日期字符串
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化数字（添加千分位分隔符）
 *
 * @param num - 数字
 * @returns 格式化后的字符串
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}
