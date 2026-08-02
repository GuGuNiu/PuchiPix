export function formatFileSize(bytes: number, unit?: 'B' | 'KB' | 'MB' | 'GB'): string {
  if (bytes == null || isNaN(bytes)) return '—';

  const absBytes = Math.abs(bytes);
  if (absBytes === 0) return '0 B';

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

  if (absBytes < 1024) return `${bytes} B`;
  if (absBytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (absBytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
