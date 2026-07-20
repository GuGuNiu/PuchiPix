import { getOrCreateGlobal } from '../../infra/global-singleton';
import type {
  TaskPhase,
  SchedulableNode,
  ExecutionContext,
  NodeExecutionResult,
  NodeProgress,
} from '@/types/dag';
import { loggers } from '../../infra/logger';

const logger = loggers.taskExecutor();

export interface TaskExecutor {
  key: string;
  supportedPhases: TaskPhase[];
  execute(
    node: SchedulableNode,
    context: ExecutionContext,
  ): Promise<NodeExecutionResult>;
  cancel(nodeId: string): Promise<void>;
  getProgress(nodeId: string): NodeProgress | null;
}

class TaskExecutorRegistry {
  private executors = new Map<string, TaskExecutor>();

  register(executor: TaskExecutor): void {
    this.executors.set(executor.key, executor);
    logger.info(`Executor registered: ${executor.key} (phases: ${executor.supportedPhases.join(', ')})`);
  }

  get(key: string): TaskExecutor | null {
    return this.executors.get(key) || null;
  }

  getByPhase(phase: TaskPhase, taskType: string): TaskExecutor | null {
    const exactKey = `${taskType}:${phase}`;
    const exact = this.executors.get(exactKey);
    if (exact) return exact;

    const typeOnly = this.executors.get(taskType);
    if (typeOnly && typeOnly.supportedPhases.includes(phase)) {
      return typeOnly;
    }

    for (const executor of this.executors.values()) {
      if (executor.supportedPhases.includes(phase)) {
        return executor;
      }
    }
    return null;
  }

  getAll(): TaskExecutor[] {
    return Array.from(this.executors.values());
  }

  clear(): void {
    this.executors.clear();
  }
}

export const taskExecutorRegistry = getOrCreateGlobal(
  '__puchipix_task_executor_registry__',
  () => new TaskExecutorRegistry(),
);
