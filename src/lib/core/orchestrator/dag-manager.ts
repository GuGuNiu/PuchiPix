/**
 * DAG 渚濊禆绠＄悊鍣?
 *
 * 涓轰换鍔＄紪鎺掑櫒鎻愪緵鏈夊悜鏃犵幆鍥句緷璧栫鐞嗚兘鍔涖€?
 * 褰撲换鍔￠棿瀛樺湪鍓嶇疆渚濊禆锛堝銆屾悳绱?鈫?鐖彇 鈫?涓嬭浇銆嶆祦姘寸嚎锛夋椂锛?
 * 纭繚琚緷璧栫殑浠诲姟瀹屾垚鍚庢墠鎵ц鍚庣画浠诲姟銆?
 *
 * 鐜娴嬪拰鎷撴墤鎺掑簭浣跨敤 Kahn 绠楁硶锛堣凯浠?BFS锛夛紝
 * 鑰岄潪閫掑綊 DFS鈥斺€旈伩鍏嶆繁灞備緷璧栭摼鐨勬爤婧㈠嚭椋庨櫓锛屽悓鏃朵竴娆￠亶鍘?
 * 鍗冲彲鍚屾椂瀹屾垚鎺掑簭鍜岀幆妫€娴嬶紝甯告暟鍥犲瓙浼樹簬鍙屾 DFS 鏂规銆?
 * 绾ц仈澶辫触浼犳挱鍚屾牱浣跨敤杩唬 BFS锛屼笌鐜娴嬬瓥鐣ヤ繚鎸佷竴鑷淬€?
 */

/** 浠诲姟鏍囪瘑绫诲瀷 */
export type DagTaskId = string | number;

/** 鍙備笌 DAG 鐨勪换鍔″繀椤绘弧瓒崇殑鎺ュ彛 */
export interface DagCapableTask {
  /** 浠诲姟鍞竴鏍囪瘑 */
  id: DagTaskId;
  /** 璋冨害浼樺厛绾э紝鏁板€艰秺澶т紭鍏堢骇瓒婇珮 */
  priority?: number;
  /** 鍓嶇疆渚濊禆浠诲姟 ID 鍒楄〃 */
  dependsOn?: DagTaskId[];
}

export interface DagStats {
  /** 褰撳墠 DAG 涓殑浠诲姟鎬绘暟 */
  taskCount: number;
  /** 渚濊禆杈规€绘暟 */
  dependencyCount: number;
  /** 褰撳墠宸插畬鎴愪换鍔℃暟 */
  completedCount: number;
  /** 褰撳墠宸插け璐ヤ换鍔℃暟 */
  failedCount: number;
  /** 鍥犱緷璧栧け璐ヨ€岀骇鑱斿彇娑堢殑浠诲姟鏁?*/
  cascadedCount: number;
  /** 褰撳墠灏辩华锛堜緷璧栧叏閮ㄦ弧瓒筹級鐨勪换鍔℃暟 */
  readyCount: number;
}

/**
 * 寰幆渚濊禆閿欒
 *
 * 褰?DAG 涓娴嬪埌寰幆渚濊禆鏃舵姏鍑猴紝鍖呭惈鐜矾涓婄殑浠诲姟 ID 閾俱€?
 */
export class DagCycleError extends Error {
  /** 鐜矾璺緞涓婄殑浠诲姟 ID 搴忓垪 */
  readonly cyclePath: DagTaskId[];

  constructor(cyclePath: DagTaskId[]) {
    const pathStr = cyclePath.map((id) => String(id)).join(' 鈫?');
    super(`妫€娴嬪埌寰幆渚濊禆: ${pathStr}`);
    this.name = 'DagCycleError';
    this.cyclePath = cyclePath;
  }
}

/**
 * 渚濊禆鏈弧瓒抽敊璇?
 *
 * 褰撳皾璇曚负涓嶅瓨鍦ㄧ殑浠诲姟娣诲姞渚濊禆鏃舵姏鍑恒€?
 */
export class DagTaskNotFoundError extends Error {
  constructor(taskId: DagTaskId) {
    super(`DAG 涓笉瀛樺湪浠诲姟: ${String(taskId)}`);
    this.name = 'DagTaskNotFoundError';
  }
}

/**
 * DAG 渚濊禆绠＄悊鍣?
 *
 * 绠＄悊浠诲姟闂寸殑鍓嶇疆渚濊禆鍏崇郴锛屾敮鎸侊細
 * - 澹版槑浠诲姟闂翠緷璧栵紙taskA 渚濊禆 taskB锛?
 * - 鍩轰簬鎷撴墤鎺掑簭鐨勫惊鐜緷璧栨娴嬶紙Kahn 绠楁硶锛岃凯浠ｅ紡锛?
 * - 渚濊禆灏辩华妫€娴嬶紙鎵€鏈夊墠缃换鍔″畬鎴愬悗鎵嶅彲鎵ц锛?
 * - 浼樺厛绾ц皟搴︼紙鍚屽氨缁换鍔′腑浼樺厛绾ч珮鑰呬紭鍏堝厛鎵ц锛?
 * - 绾ц仈澶辫触锛堝墠缃换鍔″け璐ュ悗锛屽悗缁緷璧栦换鍔¤嚜鍔ㄥ彇娑堬級
 * - 澧為噺灏辩华闆嗭紙readySet锛岄伩鍏嶆瘡娆¤皟搴﹀叏閲忔壂鎻忥級
 * - 浠诲姟娓呯悊锛坮emoveTask锛岄槻姝㈤暱鏃堕棿杩愯鍐呭瓨娉勬紡锛?
 *
 * DAG 鐙珛浜庡叿浣撲换鍔＄被鍨嬶紝閫氳繃娉涘瀷鍙傛暟 T 閫傞厤浠绘剰婊¤冻
 * {@link DagCapableTask} 鎺ュ彛鐨勪换鍔＄粨鏋勩€?
 */
export class DagManager<T extends DagCapableTask> {
  /** 浠诲姟娉ㄥ唽琛?鈥?id 鈫?task */
  private tasks = new Map<DagTaskId, T>();
  /** 姝ｅ悜閭绘帴琛?鈥?taskId 鈫?鍏朵緷璧栫殑浠诲姟 ID 闆嗗悎 */
  private dependencies = new Map<DagTaskId, Set<DagTaskId>>();
  /** 鍙嶅悜閭绘帴琛?鈥?taskId 鈫?渚濊禆瀹冪殑浠诲姟 ID 闆嗗悎 */
  private dependents = new Map<DagTaskId, Set<DagTaskId>>();
  /** 宸插畬鎴愪换鍔?ID 闆嗗悎 */
  private completed = new Set<DagTaskId>();
  /** 宸插け璐ヤ换鍔?ID 闆嗗悎 */
  private failed = new Set<DagTaskId>();
  /** 鍥犵骇鑱斿け璐ヨ€屽彇娑堢殑浠诲姟 ID 闆嗗悎 */
  private cascaded = new Set<DagTaskId>();
  /** 灏辩华浠诲姟闆?鈥?渚濊禆鍏ㄩ儴婊¤冻涓旀湭瀹屾垚/澶辫触鐨勪换鍔?ID */
  private readySet = new Set<DagTaskId>();
  /** 鍗犱綅浠诲姟闆?鈥?閫氳繃 addDependency 鑷姩鍒涘缓浣嗗皻鏈寮忔敞鍐岀殑浠诲姟 ID */
  private placeholders = new Set<DagTaskId>();

  /**
   * 娉ㄥ唽浠诲姟鍒?DAG
   *
   * 鑻ヤ换鍔″０鏄庝簡 dependsOn 瀛楁锛岃嚜鍔ㄥ缓绔嬩緷璧栬竟銆?
   * 閲嶅娉ㄥ唽鍚屼竴 ID 鐨勪换鍔′細鏇存柊浠诲姟瀵硅薄浣嗕繚鐣欏凡鏈変緷璧栧叧绯汇€?
   * 鑻ヨ ID 姝ゅ墠鏄崰浣嶄换鍔★紙閫氳繃 addDependency 鑷姩鍒涘缓锛夛紝鍒欏崌绾т负姝ｅ紡浠诲姟銆?
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
   * 澹版槑渚濊禆鍏崇郴
   *
   * task 渚濊禆 dependency锛屽嵆 dependency 蹇呴』鍏堝畬鎴愩€?
   * 鑻?dependency 浠诲姟灏氭湭娉ㄥ唽锛屼細鑷姩鍒涘缓鍗犱綅鏉＄洰骞舵爣璁颁负 placeholder銆?
   * 娣诲姞渚濊禆鍚庯紝鑻ヤ换鍔′笉鍐嶆弧瓒冲氨缁潯浠讹紝浠?readySet 涓Щ闄ゃ€?
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
   * 妫€娴嬩换鍔＄殑鎵€鏈夊墠缃緷璧栨槸鍚﹀凡瀹屾垚
   *
   * 鑻ヤ换鍔℃棤渚濊禆鎴栨墍鏈変緷璧栧潎澶勪簬 completed 闆嗗悎涓紝杩斿洖 true銆?
   * 宸插け璐ユ垨宸茬骇鑱斿彇娑堢殑浠诲姟鐩存帴杩斿洖 false銆?
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
   * 鏍囪浠诲姟瀹屾垚锛岃繑鍥炲洜姝よ鏂拌В閿佺殑浠诲姟 ID 鍒楄〃
   *
   * 褰撲竴涓换鍔″畬鎴愬悗锛屾鏌ユ墍鏈変緷璧栧畠鐨勪换鍔★紝
   * 鑻ヨ繖浜涗换鍔＄殑鍏ㄩ儴鍓嶇疆渚濊禆鍧囧凡婊¤冻锛屽垯鍔犲叆杩斿洖鍒楄〃骞舵洿鏂?readySet銆?
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
   * 鏍囪浠诲姟澶辫触锛岃繑鍥炲洜绾ц仈鑰屽彇娑堢殑浠诲姟 ID 鍒楄〃
   *
   * 鍓嶇疆浠诲姟澶辫触鍚庯紝鎵€鏈夌洿鎺ユ垨闂存帴渚濊禆瀹冪殑浠诲姟鏃犳硶鎵ц锛?
   * 閫氳繃杩唬 BFS 鏍囪涓?cascaded 骞惰繑鍥炲畬鏁村彈褰卞搷鍒楄〃銆?
   * 浣跨敤杩唬鑰岄潪閫掑綊锛岄伩鍏嶆繁灞備緷璧栭摼鐨勬爤婧㈠嚭銆?
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
   * 浠庡€欓€変换鍔′腑閫夊嚭涓嬩竴涓彲鎵ц浠诲姟
   *
   * 閫夋嫨绛栫暐锛氫緷璧栧氨缁?鈫?浼樺厛绾ч珮 鈫?鍏ラ槦鏃堕棿鏃?
   * 浣跨敤 readySet 杩涜 O(1) 灏辩华妫€鏌ワ紝閬垮厤瀵规瘡涓€欓€夎皟鐢?areDependenciesMet銆?
   * 鑻ユ棤浠讳綍浠诲姟渚濊禆灏辩华锛岃繑鍥?null銆?
   * 鑻?DAG 涓棤渚濊禆鍏崇郴锛岄€€鍖栦负浼樺厛绾ц皟搴︺€?
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
   * 妫€娴?DAG 涓槸鍚﹀瓨鍦ㄥ惊鐜緷璧?
   *
   * 浣跨敤 Kahn 绠楁硶锛堣凯浠?BFS锛夛細璁＄畻鍏ュ害锛屼粠鍏ュ害涓?0 鐨勮妭鐐瑰紑濮?
   * 閫愭娑堣В銆傝嫢鏈€缁堝鐞嗙殑鑺傜偣鏁?< 鎬昏妭鐐规暟锛屽瓨鍦ㄧ幆璺€?
   * 鏃堕棿澶嶆潅搴?O(V+E)锛屾棤閫掑綊鏍堟孩鍑洪闄┿€?
   *
   * @throws {DagCycleError} 褰撴娴嬪埌寰幆渚濊禆鏃?
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
   * 鎷撴墤鎺掑簭
   *
   * 浣跨敤 Kahn 绠楁硶杩斿洖鎸変緷璧栭『搴忔帓鍒楃殑浠诲姟鍒楄〃锛堣渚濊禆鐨勪换鍔″湪鍓嶏級銆?
   * 鍏堥€氳繃 detectCycles 纭繚鏃犵幆锛屽啀鎵ц Kahn 鎺掑簭銆?
   * 鑻ュ瓨鍦ㄧ幆璺紝鎶涘嚭 DagCycleError銆?
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
   * 浠?DAG 涓Щ闄や换鍔?
   *
   * 娓呯悊浠诲姟鐨勬墍鏈夊叧鑱旀暟鎹細浠诲姟瀵硅薄銆侀偦鎺ヨ〃杈广€佺姸鎬侀泦鍚堛€佸氨缁泦銆?
   * 绉婚櫎鍚庯紝渚濊禆姝や换鍔＄殑鍏朵粬浠诲姟鐨勪緷璧栧垪琛ㄤ篃浼氳鏇存柊銆?
   *
   * 璁捐鐞嗙敱锛氱紪鎺掑櫒鍦ㄤ换鍔″畬鎴愭垨澶辫触鍚庤皟鐢ㄦ鏂规硶锛岄槻姝㈤暱鏃堕棿杩愯
   * 鏃?tasks Map 鍜岀姸鎬侀泦鍚堟寔缁闀垮鑷村唴瀛樻硠婕忋€?
   * 绉婚櫎鏄畨鍏ㄧ殑鈥斺€斿洜涓烘墍鏈夋寚鍚戞浠诲姟鐨勮竟涔熶細琚垹闄わ紝涓嶄細鏈夊叾浠?
   * 浠诲姟鍐嶆鏌ユ浠诲姟鍦?completed/failed/cascaded 涓殑鐘舵€併€?
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

  /** 娓呴櫎鎵€鏈夌姸鎬?*/
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

  /** 鏄惁瀛樺湪浠讳綍渚濊禆鍏崇郴 */
  hasDependencies(): boolean {
    return this.dependencies.size > 0;
  }

  /** 鑾峰彇浠诲姟瀵硅薄 */
  getTask(id: DagTaskId): T | undefined {
    return this.tasks.get(id);
  }

  /** 浠诲姟鏄惁涓哄崰浣嶄换鍔★紙閫氳繃 addDependency 鑷姩鍒涘缓浣嗗皻鏈寮忔敞鍐岋級 */
  isPlaceholder(id: DagTaskId): boolean {
    return this.placeholders.has(id);
  }

  /** 浠诲姟鏄惁宸插畬鎴?*/
  isCompleted(id: DagTaskId): boolean {
    return this.completed.has(id);
  }

  /** 浠诲姟鏄惁宸插け璐ユ垨绾ц仈鍙栨秷 */
  isFailedOrCanceled(id: DagTaskId): boolean {
    return this.failed.has(id) || this.cascaded.has(id);
  }

  /**
   * 浠庡€欓€夊垪琛ㄤ腑閫夊嚭浼樺厛绾ф渶楂樸€佸叆闃熸渶鏃╃殑浠诲姟
   *
   * 浼樺厛绾ф暟鍊艰秺澶ц秺鍏堟墽琛岋紱鐩稿悓浼樺厛绾ф椂淇濇寔鍘熷椤哄簭锛團IFO锛夈€?
   */
  private pickHighestPriority(candidates: T[]): T {
    return candidates.reduce((best, current) => {
      const bestPriority = best.priority ?? 0;
      const currentPriority = current.priority ?? 0;
      return currentPriority > bestPriority ? current : best;
    });
  }

  /**
   * 鍦ㄦ畫浣欒妭鐐逛腑杩唬鏌ユ壘鐜矾璺緞
   *
   * Kahn 绠楁硶澶勭悊鍚庯紝鍏ュ害 > 0 鐨勮妭鐐瑰繀鐒跺湪鐜矾涓娿€?
   * 浠庝换涓€娈嬩綑鑺傜偣鍑哄彂锛屾部渚濊禆杈硅凯浠ｅ墠杩涳紝閬囧埌宸茶闂妭鐐瑰嵆鎵惧埌鐜矾銆?
   * 杩斿洖鐜矾璺緞锛堥灏剧浉鍚岋級锛岀敤浜?DagCycleError 鐨勮瘖鏂俊鎭€?
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
