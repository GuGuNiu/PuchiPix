import { slotTypeRegistry, registerBuiltinSlotTypes } from '../slot/type-registry';
import { slotPool } from '../slot/pool';
import { eventStore } from '../../infra/event-store';
import { dagOrchestrator } from './orchestrator';
import { schedulerEngine } from '../scheduler-engine';
import { dagConfig } from './config';
import { getOrCreateGlobal } from '../../infra/global-singleton';
import { logT } from '@/lib/i18n/server';
import { loggers } from '../../infra/logger';
import { TaskPriority, type DagDefinition, type ResourceRequirement, type StateMachineContext } from '@/types/dag';
import { galleryNodePolicy } from '../policies/gallery-node-policy';

const logger = loggers.dagInit();
import { resetRunningTasksOnStartup } from '../task/state-reset';
import { taskExecutorRegistry } from '../task/executor';
import { galleryCreateExecutor } from '../executors/gallery-create-executor';
import { galleryScrapeExecutor } from '../executors/gallery-scrape-executor';
import { galleryDownloadExecutor } from '../executors/gallery-download-executor';
import { galleryFinalizeExecutor } from '../executors/gallery-finalize-executor';

const SLOT_TIMEOUT_INTERVAL = 60 * 1000;

const EVENT_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;

const SNAPSHOT_INTERVAL = 5 * 60 * 1000;

class DagSystem {
  private _initialized = false;
  private timers: ReturnType<typeof setInterval>[] = [];

  async initialize(): Promise<void> {
    if (this._initialized) {
      logger.infoT('log.dagSystem.alreadyInitialized');
      return;
    }

    try {
      await dagConfig.ensureLoaded();

      registerBuiltinSlotTypes(slotTypeRegistry);

      await slotPool.initialize();

      schedulerEngine.syncQueueCapacityFromSlotPool();

      slotPool.setSchedulerCallback((slotType) => {
        schedulerEngine.onSlotFreed(slotType);
      });

      taskExecutorRegistry.register(galleryCreateExecutor);
      taskExecutorRegistry.register(galleryScrapeExecutor);
      taskExecutorRegistry.register(galleryDownloadExecutor);
      taskExecutorRegistry.register(galleryFinalizeExecutor);

      await resetRunningTasksOnStartup();

      await eventStore.initialize();

      await dagOrchestrator.initialize();

      this.startTimers();

      this._initialized = true;
    logger.info(
      logT('log.dagSystem.initComplete', { status: dagConfig.enabled ? 'enabled' : 'disabled' }),
      );
    } catch (err) {
      logger.errorT('log.dagSystem.initFailed', undefined, { error: err });
    }
  }

  private startTimers(): void {
    schedulerEngine.startScanTimer(2000);

    this.timers.push(
      setInterval(() => {
        slotPool.checkTimeouts();
      }, SLOT_TIMEOUT_INTERVAL),
    );

    this.timers.push(
      setInterval(async () => {
        await eventStore.cleanupOldEvents();
        await eventStore.cleanupOldSnapshots();
        await eventStore.retryPendingPersist();
      }, EVENT_CLEANUP_INTERVAL),
    );

    this.timers.push(
      setInterval(async () => {
        await dagOrchestrator.createSnapshot();
      }, SNAPSHOT_INTERVAL),
    );

    logger.infoT('log.dagSystem.timerStarted');
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    schedulerEngine.stopScanTimer();
    logger.infoT('log.dagSystem.stopped');
  }

  async shutdown(): Promise<void> {
    await dagOrchestrator.createSnapshot();

    this.stop();
    logger.infoT('log.dagSystem.gracefulShutdownComplete');
  }

  get initialized(): boolean {
    return this._initialized;
  }
}

export const dagSystem = getOrCreateGlobal(
  '__puchipix_dag_system__',
  () => new DagSystem(),
);

export function createGalleryDag(params: {
  galleryId: number;
  url: string;
  providerId: string;
  isBatch?: boolean;
}): DagDefinition {
  const { galleryId, url, providerId, isBatch = false } = params;
  const priority = isBatch ? TaskPriority.BATCH : TaskPriority.NORMAL;

  return {
    id: `gallery-${galleryId}`,
    taskType: 'gallery',
    nodes: [
      {
        id: 'create',
        phase: 'create',
        taskType: 'gallery',
        dependencies: [],
        resourceRequirements: [],
        executor: 'gallery:create',
        priority,
        config: { url, providerId, galleryId },
      },
      {
        id: 'scrape',
        phase: 'scrape',
        taskType: 'gallery',
        dependencies: ['create'],
        resourceRequirements: [
          { slotType: 'scraping', count: 1, holdUntil: 'node_complete' },
        ],
        executor: 'gallery:scrape',
        priority,
        timeout: 120_000,
        maxRetries: 2,
        config: { url, providerId, galleryId, skipVerify: false, resumableVerify: true },
        transitionPolicy: galleryNodePolicy,
      },
      {
        id: 'download',
        phase: 'download',
        taskType: 'gallery',
        dependencies: ['scrape'],
        resourceRequirements: [
          { slotType: 'download', count: 1, holdUntil: 'node_complete' },
        ],
        executor: 'gallery:download',
        priority,
        timeout: 3_600_000,
        maxRetries: 3,
        config: { galleryId, skipVerify: false, resumableVerify: true },
        transitionPolicy: galleryNodePolicy,
      },
      {
        id: 'finalize',
        phase: 'finalize',
        taskType: 'gallery',
        dependencies: ['download'],
        resourceRequirements: [],
        executor: 'gallery:finalize',
        priority,
        config: { galleryId, skipVerify: true },
        transitionPolicy: galleryNodePolicy,
      },
    ],
    metadata: {
      sourceUrl: url,
      providerId,
      createdAt: new Date(),
    },
  };
}


export function resolveRequirements(
  ctx: StateMachineContext,
): ResourceRequirement[] {
  const { definition, retryCount } = ctx;
  const config = definition.config;

  const baseReqs = definition.resourceRequirements ?? [];
  const dynamicReqs: ResourceRequirement[] = [];

  if (config.isVideo === true && definition.phase === 'download') {
    dynamicReqs.push({
      slotType: 'ts_segment',
      count: (config.tsConcurrency as number) ?? 50,
      holdUntil: 'node_complete',
    });
  }

  if (config.downloadCover === true && definition.phase === 'finalize') {
    dynamicReqs.push({
      slotType: 'gallery_image',
      count: 1,
      holdUntil: 'node_complete',
    });
  }

  if (retryCount > 1) {
    return baseReqs.concat(dynamicReqs).map((req) => ({
      ...req,
      count: Math.max(1, Math.floor(req.count / 2)),
    }));
  }

  return [...baseReqs, ...dynamicReqs];
}
