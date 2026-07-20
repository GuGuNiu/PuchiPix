/**
 * ANSI 颜色码和节点状态样式
 *
 * 统一定义所有终端输出颜色，
 * 供 UI 组件和命令模块共享。
 */

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

interface StateStyle {
  color: string;
  label: string;
}

export const STATE_STYLE: Record<string, StateStyle> = {
  pending: { color: C.gray, label: '⏳ 待就绪' },
  ready: { color: C.gray, label: '⚪ 就绪' },
  queued: { color: C.yellow, label: '🟡 排队中' },
  allocated: { color: C.blue, label: '🔵 已分配' },
  running: { color: C.cyan, label: '⚡ 执行中' },
  paused: { color: C.yellow, label: '⏸  已暂停' },
  verifying: { color: C.magenta, label: '🔍 校验中' },
  resume_verify: { color: C.magenta, label: '🔍 恢复校验' },
  completed: { color: C.green, label: '✅ 已完成' },
  failed: { color: C.red, label: '❌ 已失败' },
  cancelled: { color: C.gray, label: '🚫 已取消' },
  timeout: { color: C.red, label: '⏰ 已超时' },
};

/**
 * 获取状态标签（带颜色）
 */
export function stateLabel(state: string): string {
  const style = STATE_STYLE[state];
  if (!style) return state;
  return `${style.color}${style.label}${C.reset}`;
}

/**
 * 获取状态药丸（大写状态名，固定宽度）
 */
export function statePill(state: string): string {
  const style = STATE_STYLE[state];
  if (!style) return state.padEnd(10);
  return `${style.color}${state.toUpperCase().padEnd(10)}${C.reset}`;
}

/**
 * 日志级别样式
 */
export const LOG_LEVEL_STYLE: Record<string, { color: string; label: string }> = {
  debug: { color: C.dim, label: 'DEBUG' },
  info: { color: C.green, label: ' INFO' },
  warn: { color: C.yellow, label: ' WARN' },
  error: { color: C.red, label: 'ERROR' },
};

export function logLevelLabel(level: string): string {
  const style = LOG_LEVEL_STYLE[level.toLowerCase()];
  if (!style) return level.toUpperCase().padEnd(5);
  return `${style.color}${style.label}${C.reset}`;
}
