import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../infra/global-singleton';
import type { TaskType } from '@/types/dag';

const CONFIG_KEY_DAG_ENABLED = 'dag_scheduler_enabled';
const CONFIG_KEY_DAG_TASK_TYPES = 'dag_scheduler_task_types';

class DagConfig {
  private _enabled: boolean | null = null;
  private _taskTypes: Set<TaskType> | null = null;
  private _loaded = false;
  private _loadPromise: Promise<void> | null = null;

  async ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = this._doLoad();
    try {
      await this._loadPromise;
    } finally {
      this._loadPromise = null;
    }
  }

  private async _doLoad(): Promise<void> {
    try {
      const configs = await prisma.appConfig.findMany({
        where: {
          key: { in: [CONFIG_KEY_DAG_ENABLED, CONFIG_KEY_DAG_TASK_TYPES] },
        },
      });

      const configMap = new Map(configs.map((c) => [c.key, c.value]));

      const enabledValue = configMap.get(CONFIG_KEY_DAG_ENABLED);
      this._enabled = enabledValue == null ? true : enabledValue === 'true';

      const taskTypesStr = configMap.get(CONFIG_KEY_DAG_TASK_TYPES) || '';
      this._taskTypes = new Set(
        taskTypesStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as TaskType[],
      );

      this._loaded = true;
      console.log(
        `[DagConfig] 閰嶇疆鍔犺浇瀹屾垚: enabled=${this._enabled}, taskTypes=[${Array.from(this._taskTypes).join(', ')}]`,
      );
    } catch (err) {
      console.error('[DagConfig] 閰嶇疆鍔犺浇澶辫触:', err);
      this._enabled = true;
      this._taskTypes = new Set();
      this._loaded = true;
      console.log('[DagConfig] 浣跨敤榛樿閰嶇疆: enabled=true (鍔犺浇澶辫触鍚庣殑瀹夊叏闄嶇骇)');
    }
  }

  /**
   * DAG 璋冨害鍣ㄦ槸鍚﹀叏灞€鍚敤
   */
  async isEnabled(): Promise<boolean> {
    await this.ensureLoaded();
    return this._enabled ?? false;
  }

  /**
   * 鍚屾鑾峰彇鍚敤鐘舵€?
   */
  get enabled(): boolean {
    return this._enabled ?? false;
  }

  /**
   * 妫€鏌ユ寚瀹氫换鍔＄被鍨嬫槸鍚﹁蛋 DAG 绯荤粺
   */
  async isTaskTypeEnabled(taskType: TaskType): Promise<boolean> {
    await this.ensureLoaded();
    if (!this._enabled) return false;
    return this._taskTypes?.has(taskType) ?? false;
  }

  /**
   * 鍚屾妫€鏌ユ寚瀹氫换鍔＄被鍨嬫槸鍚﹁蛋 DAG 绯荤粺
   */
  isTaskTypeEnabledSync(taskType: TaskType): boolean {
    if (!this._enabled) return false;
    return this._taskTypes?.has(taskType) ?? false;
  }

  /**
   * 鏇存柊 DAG 璋冨害鍣ㄥ惎鐢ㄧ姸鎬?
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this._enabled = enabled;
    await prisma.appConfig.upsert({
      where: { key: CONFIG_KEY_DAG_ENABLED },
      create: { key: CONFIG_KEY_DAG_ENABLED, value: String(enabled) },
      update: { value: String(enabled) },
    });
    console.log(`[DagConfig] DAG 璋冨害鍣?${enabled ? '宸插惎鐢? : '宸茬鐢?}`);
  }

  async setTaskTypes(taskTypes: TaskType[]): Promise<void> {
    this._taskTypes = new Set(taskTypes);
    const value = taskTypes.join(',');
    await prisma.appConfig.upsert({
      where: { key: CONFIG_KEY_DAG_TASK_TYPES },
      create: { key: CONFIG_KEY_DAG_TASK_TYPES, value },
      update: { value },
    });
    console.log(`[DagConfig] DAG 浠诲姟绫诲瀷鏇存柊: [${value}]`);
  }

  get taskTypes(): Set<TaskType> {
    return this._taskTypes ?? new Set();
  }

  reset(): void {
    this._enabled = null;
    this._taskTypes = null;
    this._loaded = false;
  }
}

export const dagConfig = getOrCreateGlobal(
  '__puchipix_dag_config__',
  () => new DagConfig(),
);
