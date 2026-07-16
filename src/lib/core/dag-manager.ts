/**
 * DAG 依赖管理器
 *
 * 为任务编排器提供有向无环图依赖管理能力。
 * 当任务间存在前置依赖（如「搜索 → 爬取 → 下载」流水线）时，
 * 确保被依赖的任务完成后才执行后续任务。
 *
 * 环检测和拓扑排序使用 Kahn 算法（迭代 BFS），
 * 而非递归 DFS——避免深层依赖链的栈溢出风险，同时一次遍历
 * 即可同时完成排序和环检测，常数因子优于双次 DFS 方案。
 * 级联失败传播同样使用迭代 BFS，与环检测策略保持一致。
 */

/** 任务标识类型 */
export type DagTaskId = string | number;

/** 参与 DAG 的任务必须满足的接口 */
export interface DagCapableTask {
  /** 任务唯一标识 */
  id: DagTaskId;
  /** 调度优先级，数值越大优先级越高 */
  priority?: number;
  /** 前置依赖任务 ID 列表 */
  dependsOn?: DagTaskId[];
}

export interface DagStats {
  /** 当前 DAG 中的任务总数 */
  taskCount: number;
  /** 依赖边总数 */
  dependencyCount: number;
  /** 当前已完成任务数 */
  completedCount: number;
  /** 当前已失败任务数 */
  failedCount: number;
  /** 因依赖失败而级联取消的任务数 */
  cascadedCount: number;
  /** 当前就绪（依赖全部满足）的任务数 */
  readyCount: number;
}

/**
 * 循环依赖错误
 *
 * 当 DAG 中检测到循环依赖时抛出，包含环路上的任务 ID 链。
 */
export class DagCycleError extends Error {
  /** 环路路径上的任务 ID 序列 */
  readonly cyclePath: DagTaskId[];

  constructor(cyclePath: DagTaskId[]) {
    const pathStr = cyclePath.map((id) => String(id)).join(' → ');
    super(`检测到循环依赖: ${pathStr}`);
    this.name = 'DagCycleError';
    this.cyclePath = cyclePath;
  }
}

/**
 * 依赖未满足错误
 *
 * 当尝试为不存在的任务添加依赖时抛出。
 */
export class DagTaskNotFoundError extends Error {
  constructor(taskId: DagTaskId) {
    super(`DAG 中不存在任务: ${String(taskId)}`);
    this.name = 'DagTaskNotFoundError';
  }
}

/**
 * DAG 依赖管理器
 *
 * 管理任务间的前置依赖关系，支持：
 * - 声明任务间依赖（taskA 依赖 taskB）
 * - 基于拓扑排序的循环依赖检测（Kahn 算法，迭代式）
 * - 依赖就绪检测（所有前置任务完成后才可执行）
 * - 优先级调度（同就绪任务中优先级高者优先先执行）
 * - 级联失败（前置任务失败后，后续依赖任务自动取消）
 * - 增量就绪集（readySet，避免每次调度全量扫描）
 * - 任务清理（removeTask，防止长时间运行内存泄漏）
 *
 * DAG 独立于具体任务类型，通过泛型参数 T 适配任意满足
 * {@link DagCapableTask} 接口的任务结构。
 */
export class DagManager<T extends DagCapableTask> {
  /** 任务注册表 — id → task */
  private tasks = new Map<DagTaskId, T>();
  /** 正向邻接表 — taskId → 其依赖的任务 ID 集合 */
  private dependencies = new Map<DagTaskId, Set<DagTaskId>>();
  /** 反向邻接表 — taskId → 依赖它的任务 ID 集合 */
  private dependents = new Map<DagTaskId, Set<DagTaskId>>();
  /** 已完成任务 ID 集合 */
  private completed = new Set<DagTaskId>();
  /** 已失败任务 ID 集合 */
  private failed = new Set<DagTaskId>();
  /** 因级联失败而取消的任务 ID 集合 */
  private cascaded = new Set<DagTaskId>();
  /** 就绪任务集 — 依赖全部满足且未完成/失败的任务 ID */
  private readySet = new Set<DagTaskId>();
  /** 占位任务集 — 通过 addDependency 自动创建但尚未正式注册的任务 ID */
  private placeholders = new Set<DagTaskId>();

  /**
   * 注册任务到 DAG
   *
   * 若任务声明了 dependsOn 字段，自动建立依赖边。
   * 重复注册同一 ID 的任务会更新任务对象但保留已有依赖关系。
   * 若该 ID 此前是占位任务（通过 addDependency 自动创建），则升级为正式任务。
   */
  addTask(task: T): void {
    const id = task.id;
    const existing = this.tasks.get(id);

    this.tasks.set(id, task);
    this.placeholders.delete(id);

    if (!existing) {
      this.dependencies.set(id, new Set());
      this.dependents.set(id, new Set());
    }

    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        this.addDependency(id, depId);
      }
    }

    if (this.areDependenciesMet(id)) {
      this.readySet.add(id);
    }
  }

  /**
   * 声明依赖关系
   *
   * task 依赖 dependency，即 dependency 必须先完成。
   * 若 dependency 任务尚未注册，会自动创建占位条目并标记为 placeholder。
   * 添加依赖后，若任务不再满足就绪条件，从 readySet 中移除。
   */
  addDependency(taskId: DagTaskId, dependsOnId: DagTaskId): void {
    if (taskId === dependsOnId) {
      throw new DagCycleError([taskId, taskId]);
    }

    if (!this.tasks.has(taskId)) {
      throw new DagTaskNotFoundError(taskId);
    }

    if (!this.tasks.has(dependsOnId)) {
      this.placeholders.add(dependsOnId);
      this.tasks.set(dependsOnId, { id: dependsOnId } as T);
      this.dependencies.set(dependsOnId, new Set());
      this.dependents.set(dependsOnId, new Set());
    }

    this.dependencies.get(taskId)!.add(dependsOnId);
    this.dependents.get(dependsOnId)!.add(taskId);

    if (!this.areDependenciesMet(taskId)) {
      this.readySet.delete(taskId);
    }
  }

  /**
   * 检测任务的所有前置依赖是否已完成
   *
   * 若任务无依赖或所有依赖均处于 completed 集合中，返回 true。
   * 已失败或已级联取消的任务直接返回 false。
   */
  areDependenciesMet(taskId: DagTaskId): boolean {
    if (this.failed.has(taskId) || this.cascaded.has(taskId)) return false;

    const deps = this.dependencies.get(taskId);
    if (!deps || deps.size === 0) return true;

    for (const depId of deps) {
      if (!this.completed.has(depId)) return false;
    }
    return true;
  }

  /**
   * 标记任务完成，返回因此被新解锁的任务 ID 列表
   *
   * 当一个任务完成后，检查所有依赖它的任务，
   * 若这些任务的全部前置依赖均已满足，则加入返回列表并更新 readySet。
   */
  markCompleted(taskId: DagTaskId): DagTaskId[] {
    this.completed.add(taskId);
    this.readySet.delete(taskId);

    const newlyUnblocked: DagTaskId[] = [];
    const dependents = this.dependents.get(taskId);
    if (!dependents) return newlyUnblocked;

    for (const depId of dependents) {
      if (this.areDependenciesMet(depId)) {
        this.readySet.add(depId);
        newlyUnblocked.push(depId);
      }
    }
    return newlyUnblocked;
  }

  /**
   * 标记任务失败，返回因级联而取消的任务 ID 列表
   *
   * 前置任务失败后，所有直接或间接依赖它的任务无法执行，
   * 通过迭代 BFS 标记为 cascaded 并返回完整受影响列表。
   * 使用迭代而非递归，避免深层依赖链的栈溢出。
   */
  markFailed(taskId: DagTaskId): DagTaskId[] {
    this.failed.add(taskId);
    this.readySet.delete(taskId);

    const cascadedIds: DagTaskId[] = [];
    const queue: DagTaskId[] = [taskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = this.dependents.get(current);

      if (!dependents) continue;

      for (const depId of dependents) {
        if (this.cascaded.has(depId) || this.failed.has(depId)) continue;
        this.cascaded.add(depId);
        this.readySet.delete(depId);
        cascadedIds.push(depId);
        queue.push(depId);
      }
    }

    return cascadedIds;
  }

  /**
   * 从候选任务中选出下一个可执行任务
   *
   * 选择策略：依赖就绪 → 优先级高 → 入队时间早
   * 使用 readySet 进行 O(1) 就绪检查，避免对每个候选调用 areDependenciesMet。
   * 若无任何任务依赖就绪，返回 null。
   * 若 DAG 中无依赖关系，退化为优先级调度。
   */
  getNextExecutable(candidates: T[]): T | null {
    if (candidates.length === 0) return null;

    const hasDependencies = this.dependencies.size > 0;
    if (!hasDependencies) {
      return this.pickHighestPriority(candidates);
    }

    const ready = candidates.filter((t) => this.readySet.has(t.id));
    if (ready.length === 0) return null;

    return this.pickHighestPriority(ready);
  }

  /**
   * 检测 DAG 中是否存在循环依赖
   *
   * 使用 Kahn 算法（迭代 BFS）：计算入度，从入度为 0 的节点开始
   * 逐步消解。若最终处理的节点数 < 总节点数，存在环路。
   * 时间复杂度 O(V+E)，无递归栈溢出风险。
   *
   * @throws {DagCycleError} 当检测到循环依赖时
   */
  detectCycles(): void {
    const inDegree = new Map<DagTaskId, number>();

    for (const id of this.tasks.keys()) {
      inDegree.set(id, this.dependencies.get(id)?.size ?? 0);
    }

    const queue: DagTaskId[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let processed = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      processed++;

      const dependents = this.dependents.get(current);
      if (dependents) {
        for (const depId of dependents) {
          const newDeg = (inDegree.get(depId) ?? 0) - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) queue.push(depId);
        }
      }
    }

    if (processed < this.tasks.size) {
      const remaining = new Set<DagTaskId>();
      for (const [id, deg] of inDegree) {
        if (deg > 0) remaining.add(id);
      }
      const cyclePath = this.findCyclePath(remaining);
      throw new DagCycleError(cyclePath);
    }
  }

  /**
   * 拓扑排序
   *
   * 使用 Kahn 算法返回按依赖顺序排列的任务列表（被依赖的任务在前）。
   * 先通过 detectCycles 确保无环，再执行 Kahn 排序。
   * 若存在环路，抛出 DagCycleError。
   */
  topologicalSort(): T[] {
    this.detectCycles();

    const inDegree = new Map<DagTaskId, number>();
    for (const id of this.tasks.keys()) {
      inDegree.set(id, this.dependencies.get(id)?.size ?? 0);
    }

    const queue: DagTaskId[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const result: T[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const task = this.tasks.get(current);
      if (task) {
        result.push(task);
      }

      const dependents = this.dependents.get(current);
      if (dependents) {
        for (const depId of dependents) {
          const newDeg = (inDegree.get(depId) ?? 0) - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) queue.push(depId);
        }
      }
    }

    return result;
  }

  /**
   * 从 DAG 中移除任务
   *
   * 清理任务的所有关联数据：任务对象、邻接表边、状态集合、就绪集。
   * 移除后，依赖此任务的其他任务的依赖列表也会被更新。
   *
   * 设计理由：编排器在任务完成或失败后调用此方法，防止长时间运行
   * 时 tasks Map 和状态集合持续增长导致内存泄漏。
   * 移除是安全的——因为所有指向此任务的边也会被删除，不会有其他
   * 任务再检查此任务在 completed/failed/cascaded 中的状态。
   */
  removeTask(id: DagTaskId): void {
    const deps = this.dependencies.get(id);
    if (deps) {
      for (const depId of deps) {
        this.dependents.get(depId)?.delete(id);
      }
    }

    const dependents = this.dependents.get(id);
    if (dependents) {
      for (const depId of dependents) {
        this.dependencies.get(depId)?.delete(id);
      }
    }

    this.tasks.delete(id);
    this.dependencies.delete(id);
    this.dependents.delete(id);
    this.completed.delete(id);
    this.failed.delete(id);
    this.cascaded.delete(id);
    this.readySet.delete(id);
    this.placeholders.delete(id);
  }

  /** 清除所有状态 */
  clear(): void {
    this.tasks.clear();
    this.dependencies.clear();
    this.dependents.clear();
    this.completed.clear();
    this.failed.clear();
    this.cascaded.clear();
    this.readySet.clear();
    this.placeholders.clear();
  }

  getStats(): DagStats {
    let depCount = 0;
    for (const deps of this.dependencies.values()) {
      depCount += deps.size;
    }

    return {
      taskCount: this.tasks.size,
      dependencyCount: depCount,
      completedCount: this.completed.size,
      failedCount: this.failed.size,
      cascadedCount: this.cascaded.size,
      readyCount: this.readySet.size,
    };
  }

  /** 是否存在任何依赖关系 */
  hasDependencies(): boolean {
    return this.dependencies.size > 0;
  }

  /** 获取任务对象 */
  getTask(id: DagTaskId): T | undefined {
    return this.tasks.get(id);
  }

  /** 任务是否为占位任务（通过 addDependency 自动创建但尚未正式注册） */
  isPlaceholder(id: DagTaskId): boolean {
    return this.placeholders.has(id);
  }

  /** 任务是否已完成 */
  isCompleted(id: DagTaskId): boolean {
    return this.completed.has(id);
  }

  /** 任务是否已失败或级联取消 */
  isFailedOrCanceled(id: DagTaskId): boolean {
    return this.failed.has(id) || this.cascaded.has(id);
  }

  /**
   * 从候选列表中选出优先级最高、入队最早的任务
   *
   * 优先级数值越大越先执行；相同优先级时保持原始顺序（FIFO）。
   */
  private pickHighestPriority(candidates: T[]): T {
    return candidates.reduce((best, current) => {
      const bestPriority = best.priority ?? 0;
      const currentPriority = current.priority ?? 0;
      return currentPriority > bestPriority ? current : best;
    });
  }

  /**
   * 在残余节点中迭代查找环路路径
   *
   * Kahn 算法处理后，入度 > 0 的节点必然在环路上。
   * 从任一残余节点出发，沿依赖边迭代前进，遇到已访问节点即找到环路。
   * 返回环路路径（首尾相同），用于 DagCycleError 的诊断信息。
   */
  private findCyclePath(remaining: Set<DagTaskId>): DagTaskId[] {
    if (remaining.size === 0) return [];

    const start = remaining.values().next().value;
    if (start === undefined) return [];
    const path: DagTaskId[] = [start];
    const visited = new Set<DagTaskId>([start]);
    let current: DagTaskId = start;

    while (true) {
      const deps = this.dependencies.get(current);
      if (!deps) break;

      let next: DagTaskId | undefined;
      for (const dep of deps) {
        if (remaining.has(dep)) {
          next = dep;
          break;
        }
      }

      if (next === undefined) break;

      if (visited.has(next)) {
        const cycleStart = path.indexOf(next);
        return path.slice(cycleStart).concat(next);
      }

      path.push(next);
      visited.add(next);
      current = next;
    }

    return path;
  }
}
