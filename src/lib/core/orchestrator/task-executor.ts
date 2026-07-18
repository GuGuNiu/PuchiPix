import { getOrCreateGlobal } from '../infra/global-singleton';
import type {
  TaskPhase,
  SchedulableNode,
  ExecutionContext,
  NodeExecutionResult,
  NodeProgress,
} from '@/types/dag';

/**
 * 浠诲姟鎵ц鍣ㄦ帴鍙?
 *
 * Service 灞傚疄鐜版鎺ュ彛锛孋ore 灞傞€氳繃鎺ュ彛椹卞姩鎵ц銆?
 */
export interface TaskExecutor {
  /** 鎵ц鍣ㄦ爣璇?*/
  key: string;
  /** 鏀寔鐨勮妭鐐归樁娈?*/
  supportedPhases: TaskPhase[];
  /**
   * 鎵ц鑺傜偣
   *
   * @param node - 鑺傜偣瀹氫箟
   * @param context - 鎵ц涓婁笅鏂囷紙杩涘害鍥炶皟銆佸彇娑堝洖璋冪瓑锛?
   * @returns 鎵ц缁撴灉
   */
  execute(
    node: SchedulableNode,
    context: ExecutionContext,
  ): Promise<NodeExecutionResult>;
  /**
   * 鍙栨秷鎵ц
   */
  cancel(nodeId: string): Promise<void>;
  /**
   * 鑾峰彇鎵ц杩涘害
   */
  getProgress(nodeId: string): NodeProgress | null;
}

/**
 * 鎵ц鍣ㄦ敞鍐岃〃 鈥?娉ㄥ唽寮忔墿灞曪紝鏂板浠诲姟绫诲瀷涓嶆敼 Core
 */
class TaskExecutorRegistry {
  private executors = new Map<string, TaskExecutor>();

  /**
   * 娉ㄥ唽鎵ц鍣?
   */
  register(executor: TaskExecutor): void {
    this.executors.set(executor.key, executor);
    console.log(`[ExecutorRegistry] 娉ㄥ唽鎵ц鍣? ${executor.key} (phases: ${executor.supportedPhases.join(', ')})`);
  }

  /**
   * 鑾峰彇鎵ц鍣?
   */
  get(key: string): TaskExecutor | null {
    return this.executors.get(key) || null;
  }

  /**
   * 鎸夐樁娈靛拰浠诲姟绫诲瀷鏌ユ壘鎵ц鍣?
   */
  getByPhase(phase: TaskPhase, taskType: string): TaskExecutor | null {
    // 浼樺厛绮剧‘鍖归厤 taskType:phase
    const exactKey = `${taskType}:${phase}`;
    const exact = this.executors.get(exactKey);
    if (exact) return exact;

    // 閫€鑰屾眰鍏舵锛屽尮閰?taskType
    const typeOnly = this.executors.get(taskType);
    if (typeOnly && typeOnly.supportedPhases.includes(phase)) {
      return typeOnly;
    }

    // 鏈€鍚庢寜闃舵鍖归厤
    for (const executor of this.executors.values()) {
      if (executor.supportedPhases.includes(phase)) {
        return executor;
      }
    }
    return null;
  }

  /**
   * 鑾峰彇鎵€鏈夊凡娉ㄥ唽鐨勬墽琛屽櫒
   */
  getAll(): TaskExecutor[] {
    return Array.from(this.executors.values());
  }

  /**
   * 娓呴櫎鎵€鏈夋敞鍐岋紙鐢ㄤ簬娴嬭瘯锛?
   */
  clear(): void {
    this.executors.clear();
  }
}

export const taskExecutorRegistry = getOrCreateGlobal(
  '__puchipix_task_executor_registry__',
  () => new TaskExecutorRegistry(),
);
