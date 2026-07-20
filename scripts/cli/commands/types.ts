/**
 * 命令接口定义
 *
 * 每个命令模块导出一个符合此接口的对象，
 * 由命令注册表统一管理。
 */

import type { DagClient } from '@/lib/dag-client';

export interface CommandContext {
  /** DAG API 客户端实例 */
  client: DagClient;
  /** 命令行参数（已移除全局选项和命令名） */
  args: string[];
}

export interface Command {
  /** 命令名称 */
  name: string;
  /** 简短描述 */
  description: string;
  /** 用法说明 */
  usage: string;
  /** 别名 */
  aliases?: string[];
  /** 执行命令 */
  execute(ctx: CommandContext): Promise<void>;
}
