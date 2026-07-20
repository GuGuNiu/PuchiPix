/**
 * 可复用终端 UI 组件
 *
 * 提供分割线、进度条、表格等可复用的终端渲染组件。
 */

import { C } from './colors';

/**
 * 打印分割线
 */
export function printDivider(title?: string): void {
  if (title) {
    const line = '─'.repeat(Math.max(0, 60 - title.length - 3));
    console.log(`${C.bold}── ${title} ${line}${C.reset}`);
  } else {
    console.log(`${C.dim}${'─'.repeat(64)}${C.reset}`);
  }
}

/**
 * 渲染进度条
 *
 * @example
 * renderProgressBar(5, 10, 20);
 * // █████░░░░░░░░░░░░░░░ 5/10 (50%)
 */
export function renderProgressBar(
  current: number,
  max: number,
  barWidth: number = 20,
): string {
  const filled = max > 0 ? Math.round((current / max) * barWidth) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barWidth - filled));
  const pct = max > 0 ? Math.round((current / max) * 100) : 0;
  const color = pct >= 100 ? C.red : pct >= 80 ? C.yellow : C.green;
  return `${color}${bar}${C.reset} ${current}/${max} (${pct}%)`;
}

/**
 * 渲染键值对
 */
export function printKeyValue(key: string, value: unknown): void {
  console.log(`  ${C.bold}${key}${C.reset}: ${value}`);
}

/**
 * 渲染信息块
 */
export function printInfo(label: string, items: Array<[string, unknown]>): void {
  printDivider(label);
  for (const [key, value] of items) {
    printKeyValue(key, value);
  }
  console.log();
}
