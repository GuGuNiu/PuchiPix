/**
 * Get or create HMR security globalSingleton。
 *
 * @returns Singletoninstance
 */
export function getOrCreateGlobal<T>(key: string, factory: () => T): T {
  const g = globalThis as Record<string, unknown>;
  if (!g[key]) {
    g[key] = factory();
  }
  return g[key] as T;
}


export function getGlobalIfExists<T>(key: string): T | null {
  const g = globalThis as Record<string, unknown>;
  return (g[key] as T | undefined) ?? null;
}


export function removeGlobal(key: string): void {
  const g = globalThis as Record<string, unknown>;
  delete g[key];
}

/**
 * CanpassthisfunctionRegisterClean upCallback。
 *
 */
export function registerHotDispose(cleanup: () => void): void {
  const mod = module as unknown as { hot?: { dispose?: (cb: () => void) => void } };
  if (mod.hot?.dispose) {
    mod.hot.dispose(cleanup);
  }
}
