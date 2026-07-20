export type DagTaskId = string | number;

export interface DagCapableTask {
  id: DagTaskId;
  priority?: number;
  dependsOn?: DagTaskId[];
}

export interface DagStats {
  taskCount: number;
  dependencyCount: number;
  completedCount: number;
  failedCount: number;
  cascadedCount: number;
  readyCount: number;
}


export class DagCycleError extends Error {
  readonly cyclePath: DagTaskId[];

  constructor(cyclePath: DagTaskId[]) {
    const pathStr = cyclePath.map((id) => String(id)).join(' → ');
    super(`检测到循环依赖: ${pathStr}`);
    this.name = 'DagCycleError';
    this.cyclePath = cyclePath;
  }
}


export class DagTaskNotFoundError extends Error {
  constructor(taskId: DagTaskId) {
    super(`DAG 中不存在任务: ${String(taskId)}`);
    this.name = 'DagTaskNotFoundError';
  }
}


export class DagManager<T extends DagCapableTask> {
  private tasks = new Map<DagTaskId, T>();
  private dependencies = new Map<DagTaskId, Set<DagTaskId>>();
  private dependents = new Map<DagTaskId, Set<DagTaskId>>();
  /** Completetask ID Set */
  private completed = new Set<DagTaskId>();
  /** Failtask ID Set */
  private failed = new Set<DagTaskId>();
  private cascaded = new Set<DagTaskId>();
  private readySet = new Set<DagTaskId>();
  private placeholders = new Set<DagTaskId>();

  /**
   * Registertaskto DAG
   *
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

  
  areDependenciesMet(taskId: DagTaskId): boolean {
    if (this.failed.has(taskId) || this.cascaded.has(taskId)) return false;

    const deps = this.dependencies.get(taskId);
    if (!deps || deps.size === 0) return true;

    for (const depId of deps) {
      if (!this.completed.has(depId)) return false;
    }
    return true;
  }

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

  /** ClearallState */
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

  hasDependencies(): boolean {
    return this.dependencies.size > 0;
  }

  /** Get taskobject */
  getTask(id: DagTaskId): T | undefined {
    return this.tasks.get(id);
  }

  isPlaceholder(id: DagTaskId): boolean {
    return this.placeholders.has(id);
  }

  isCompleted(id: DagTaskId): boolean {
    return this.completed.has(id);
  }

  isFailedOrCanceled(id: DagTaskId): boolean {
    return this.failed.has(id) || this.cascaded.has(id);
  }

  
  private pickHighestPriority(candidates: T[]): T {
    return candidates.reduce((best, current) => {
      const bestPriority = best.priority ?? 0;
      const currentPriority = current.priority ?? 0;
      return currentPriority > bestPriority ? current : best;
    });
  }

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
