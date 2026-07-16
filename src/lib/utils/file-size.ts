
const FILE_SIZE_MULTIPLIERS: Record<string, number> = {
  B: 1,
  K: 1024,
  M: 1024 * 1024,
  G: 1024 * 1024 * 1024,
  T: 1024 * 1024 * 1024 * 1024,
};

export function parseFileSize(text: string): number {
  if (!text) return 0;
  const match = text.trim().match(/^([\d.]+)\s*([KMGT]B?|B)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase().replace('B', '') || 'B';
  const multiplier = FILE_SIZE_MULTIPLIERS[unit] || 1;
  return Math.floor(value * multiplier);
}

export function formatFileSize(bytes: number, unit?: 'B' | 'KB' | 'MB' | 'GB'): string {
  if (bytes == null || isNaN(bytes)) return '—';

  const absBytes = Math.abs(bytes);
  if (absBytes === 0) return '0 B';

  // 如果指定了最小单位，从该单位开始格式化
  if (unit) {
    const unitMultipliers: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };
    const multiplier = unitMultipliers[unit] || 1;
    return `${(bytes / multiplier).toFixed(1)} ${unit}`;
  }

  // 自动选择合适的单位
  if (absBytes < 1024) return `${bytes} B`;
  if (absBytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (absBytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 将字节数格式化为指定精度的可读字符串
 *
 * @param bytes - 字节数
 * @param decimals - 小数位数（默认 1）
 * @returns 格式化后的字符串
 */
export function formatFileSizePrecise(bytes: number, decimals: number = 1): string {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';

  const absBytes = Math.abs(bytes);
  const units = ['B', 'KB', 'MB', 'GB'];
  const threshold = 1024;

  let unitIndex = 0;
  let value = absBytes;

  while (value >= threshold && unitIndex < units.length - 1) {
    value /= threshold;
    unitIndex++;
  }

  return `${bytes < 0 ? '-' : ''}${value.toFixed(decimals)} ${units[unitIndex]}`;
}

/**
 * 比较两个文件大小字符串的大小
 *
 * @param sizeA - 文件大小字符串 A
 * @param sizeB - 文件大小字符串 B
 * @returns -1: A<B, 0: A=B, 1: A>B
 */
export function compareFileSizes(sizeA: string, sizeB: string): number {
  const bytesA = parseFileSize(sizeA);
  const bytesB = parseFileSize(sizeB);
  if (bytesA < bytesB) return -1;
  if (bytesA > bytesB) return 1;
  return 0;
}
