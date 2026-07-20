import { eventBus } from './event-bus';
import { workerManager } from './worker-manager';
import { createLogger } from './logger';
import type { EventName, EventMap } from './event-bus';

const logger = createLogger('IpcBridge');

/**
 * Establish the Worker-side IPC bridge: forward EventBus events to the parent
 * process via process.send(). The parent process receives these as
 * { type: 'event', event, payload } messages via WorkerManager.
 */
export function setupWorkerIpcBridge(): void {
  eventBus.setIpcBridge((event: string, payload: unknown) => {
    if (process.send) {
      try {
        process.send({ type: 'event', event, payload });
      } catch (err) {
        logger.error('Failed to send IPC event to parent', { event, error: err });
      }
    }
  });

  logger.info('Worker IPC bridge established');
}

/** Remove the Worker-side IPC bridge (called during graceful shutdown). */
export function teardownWorkerIpcBridge(): void {
  eventBus.removeIpcBridge();
}

/**
 * Establish the main-process IPC bridge: forward Worker events to EventBus.
 *
 * A single listener re-emits ALL worker events (including worker:restarting
 * and worker:ready) to the main-process EventBus. The previous implementation
 * registered a second redundant listener for worker:restarting/worker:ready,
 * causing those events to be double-emitted.
 */
export function setupMainIpcBridge(): void {
  workerManager.on('event', (event: string, payload: unknown) => {
    try {
      eventBus.emit(event as EventName, payload as EventMap[EventName]);
    } catch (err) {
      logger.error('Failed to re-emit IPC event to EventBus', { event, error: err });
    }
  });

  logger.info('Main IPC bridge established');
}
