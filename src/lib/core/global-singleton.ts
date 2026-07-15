/**
 * 获取或创建 HMR 安全的全局单例。
 *
 * @param key - 全局唯一键名（建议使用 `__` 前缀避免冲突）
 * @param factory - 首次创建时调用的工厂函数
 * @returns 单例实例
 */
export function getOrCreateGlobal<T>(key: string, factory: () => T): T {
  const g = globalThis as Record<string, unknown>;
  if (!g[key]) {
    g[key] = factory();
  }
  return g[key] as T;
}

/**
 * 检查全局单例是否已存在（未创建则返回 null）。
 *
 * 用于需要判断是否已初始化的场景。
 */
export function getGlobalIfExists<T>(key: string): T | null {
  const g = globalThis as Record<string, unknown>;
  return (g[key] as T | undefined) ?? null;
}

/**
 * 销毁并移除全局单例。
 *
 * 用于测试或 HMR 重置场景。
 */
export function removeGlobal(key: string): void {
  const g = globalThis as Record<string, unknown>;
  delete g[key];
}

/**
 * HMR 重置钩子 —— 在开发模式下，当模块被热替换时，
 * 可以通过此函数注册清理回调。
 *
 * Next.js 的 `hotDispose` API 在 `module.hot` 上提供。
 * 本函数安全地检查 `module.hot` 是否存在。
 */
export function registerHotDispose(cleanup: () => void): void {
  const mod = module as unknown as { hot?: { dispose?: (cb: () => void) => void } };
  if (mod.hot?.dispose) {
    mod.hot.dispose(cleanup);
  }
}
