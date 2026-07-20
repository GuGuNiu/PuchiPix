/**
 * 终端格式化工具
 *
 * 提供时间、字符串截断等通用格式化函数。
 */

/**
 * 格式化时间为 HH:MM:SS
 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mi}:${ss}`;
}

/**
 * 格式化日期时间为 MM-DD HH:MM:SS
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * 截断字符串，超长部分用 … 替代
 */
export function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * 将毫秒转为人类可读的时长
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * 计算两个 ISO 时间戳之间的时长（毫秒）
 */
export function durationBetween(startIso: string, endIso: string): number {
  return new Date(endIso).getTime() - new Date(startIso).getTime();
}
