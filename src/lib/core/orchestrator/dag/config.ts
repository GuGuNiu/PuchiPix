import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../../infra/global-singleton';
import { logT } from '@/lib/i18n/server';
import { loggers } from '../../infra/logger';
import type { TaskType } from '@/types/dag';

const logger = loggers.dagConfig();

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
      const parsedTypes = taskTypesStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as TaskType[];
      this._taskTypes = new Set(parsedTypes.length > 0 ? parsedTypes : ['gallery', 'video', 'sniff']);

      this._loaded = true;
    logger.info(
      logT('log.dagConfig.configLoadComplete', {
          enabled: String(this._enabled),
          taskTypes: Array.from(this._taskTypes).join(', '),
        }),
      );
    } catch (err) {
      logger.errorT('log.dagConfig.configLoadFailed', undefined, { error: err });
      this._enabled = true;
      this._taskTypes = new Set();
      this._loaded = true;
      logger.infoT('log.dagConfig.usingDefaultConfig');
    }
  }

  async isEnabled(): Promise<boolean> {
    await this.ensureLoaded();
    return this._enabled ?? false;
  }

  get enabled(): boolean {
    return this._enabled ?? false;
  }

  async isTaskTypeEnabled(taskType: TaskType): Promise<boolean> {
    await this.ensureLoaded();
    if (!this._enabled) return false;
    return this._taskTypes?.has(taskType) ?? false;
  }

  isTaskTypeEnabledSync(taskType: TaskType): boolean {
    if (!this._enabled) return false;
    return this._taskTypes?.has(taskType) ?? false;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this._enabled = enabled;
    await prisma.appConfig.upsert({
      where: { key: CONFIG_KEY_DAG_ENABLED },
      create: { key: CONFIG_KEY_DAG_ENABLED, value: String(enabled) },
      update: { value: String(enabled) },
    });
    logger.infoT('log.dagConfig.schedulerToggle', { status: enabled ? 'enabled' : 'disabled' });
  }

  async setTaskTypes(taskTypes: TaskType[]): Promise<void> {
    this._taskTypes = new Set(taskTypes);
    const value = taskTypes.join(',');
    await prisma.appConfig.upsert({
      where: { key: CONFIG_KEY_DAG_TASK_TYPES },
      create: { key: CONFIG_KEY_DAG_TASK_TYPES, value },
      update: { value },
    });
    logger.infoT('log.dagConfig.taskTypesUpdated', { value });
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
