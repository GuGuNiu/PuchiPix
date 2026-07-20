/**
 * CLI 配置管理
 *
 * 从环境变量和命令行参数中解析配置，
 * 供所有命令共享同一份连接参数。
 */

export interface CliConfig {
  host: string;
  port: string;
  baseUrl: string;
}

/**
 * 从环境变量创建基础配置
 *
 * 环境变量：
 *   PUCHIPIX_HOST  — 服务地址（默认 localhost）
 *   PUCHIPIX_PORT  — 服务端口（默认 10540）
 */
export function createConfigFromEnv(): CliConfig {
  const host = process.env.PUCHIPIX_HOST || 'localhost';
  const port = process.env.PUCHIPIX_PORT || '10540';
  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
  };
}

/**
 * 从命令行参数中提取全局选项并返回剩余参数
 *
 * 支持的全局选项：
 *   --host <addr>   覆盖服务地址
 *   --port <port>   覆盖服务端口
 *   -h, --help      显示帮助
 */
export function parseGlobalOptions(
  args: string[],
): { config: CliConfig; remaining: string[]; showHelp: boolean } {
  const baseConfig = createConfigFromEnv();
  const remaining: string[] = [];
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--host' && i + 1 < args.length) {
      baseConfig.host = args[++i];
      baseConfig.baseUrl = `http://${baseConfig.host}:${baseConfig.port}`;
    } else if (arg === '--port' && i + 1 < args.length) {
      baseConfig.port = args[++i];
      baseConfig.baseUrl = `http://${baseConfig.host}:${baseConfig.port}`;
    } else if (arg === '-h' || arg === '--help') {
      showHelp = true;
    } else {
      remaining.push(arg);
    }
  }

  return { config: baseConfig, remaining, showHelp };
}

/**
 * 从参数数组中提取指定 flag 的值
 *
 * @example
 * const limit = extractFlag(args, '--limit', '50');
 */
export function extractFlag(
  args: string[],
  flag: string,
  defaultValue?: string,
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}
