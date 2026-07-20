

import type { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import type { ProgressMessage } from '@/types';
import { createLogger, runWithTraceContext } from '@/lib/core/infra/logger';
import { eventBus } from '@/lib/core/infra/event-bus';
import { dagSnapshotCache } from '@/lib/core/orchestrator/dag/snapshot-cache';
import { workerManager } from '@/lib/core/infra/worker-manager';

const logger = createLogger('WebSocket');

let io: SocketIOServer | null = null;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Messageprotocoltype
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Client → server Command */
export interface ClientCommand {
  /** Commandtype */
  action: 'pause' | 'resume' | 'retry' | 'cancel' | 'query' | 'subscribe' | 'unsubscribe' | 'stats' | 'help';
  requestId?: string;
  /** DAG ID */
  dagId?: string;
  nodeId?: string;
  params?: Record<string, unknown>;
}

/** Server → client Response */
export interface ServerResponse {
  requestId?: string;
  /** Commandtype */
  action: string;
  /** IsnoSuccess */
  success: boolean;
  /** Response data */
  data?: unknown;
  /** Error info */
  error?: string;
  timestamp: string;
}

/** ServerPush Eventmessage */
export interface ServerEvent {
  /** Eventtype */
  type: string;
  payload: unknown;
  timestamp: string;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CommandHandler
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function handleCommand(socket: Socket, cmd: ClientCommand): Promise<ServerResponse> {
  const ts = (): string => new Date().toISOString();
  const { action, requestId, dagId, nodeId, params: _params } = cmd;

  const respond = (success: boolean, data?: unknown, error?: string): ServerResponse => ({
    requestId,
    action,
    success,
    data,
    error,
    timestamp: ts(),
  });

  switch (action) {
    case 'query': {
      if (dagId) {
        const snapshot = dagSnapshotCache.getDagSnapshot(dagId);
        if (!snapshot) {
          return respond(false, undefined, `DAG ${dagId} not found`);
        }
        return respond(true, { snapshot, cacheAvailable: dagSnapshotCache.isAvailable() });
      }
      const snapshots = dagSnapshotCache.getAllDagSnapshots();
      const stats = dagSnapshotCache.getDagStats();
      return respond(true, { dags: snapshots, stats, cacheAvailable: dagSnapshotCache.isAvailable() });
    }

    case 'stats': {
      const dagStats = dagSnapshotCache.getDagStats();
      const schedulerStats = dagSnapshotCache.getSchedulerStats();
      const slotSnapshot = dagSnapshotCache.getSlotSnapshot();
      return respond(true, { dags: dagStats, scheduler: schedulerStats, slots: slotSnapshot, cacheAvailable: dagSnapshotCache.isAvailable() });
    }

    case 'pause': {
      if (!dagId) return respond(false, undefined, 'Missing dagId parameter');
      const sent = workerManager.send({ type: 'dag:command', payload: { dagId, command: 'pause', nodeId } });
      if (!sent) return respond(false, undefined, 'Worker unavailable');
      return respond(true, { dagId, snapshot: null, message: 'Pause command sent to worker' });
    }

    case 'resume': {
      if (!dagId) return respond(false, undefined, 'Missing dagId parameter');
      const sent = workerManager.send({ type: 'dag:command', payload: { dagId, command: 'resume', nodeId } });
      if (!sent) return respond(false, undefined, 'Worker unavailable');
      return respond(true, { dagId, snapshot: null, message: 'Resume command sent to worker' });
    }

    case 'retry': {
      if (!dagId) return respond(false, undefined, 'Missing dagId parameter');
      const sent = workerManager.send({ type: 'dag:command', payload: { dagId, command: 'retry', nodeId } });
      if (!sent) return respond(false, undefined, 'Worker unavailable');
      return respond(true, { dagId, snapshot: null, message: 'Retry command sent to worker' });
    }

    case 'cancel': {
      if (!dagId) return respond(false, undefined, 'Missing dagId parameter');
      const sent = workerManager.send({ type: 'dag:command', payload: { dagId, command: 'cancel', nodeId } });
      if (!sent) return respond(false, undefined, 'Worker unavailable');
      return respond(true, { dagId, snapshot: null, message: 'Cancel command sent to worker' });
    }

    // ── SubscribeCommand ──────────────────────────────────────────────────
    case 'subscribe': {
      if (!dagId) return respond(false, undefined, 'Missing dagId parameter');
      const room = `dag:${dagId}`;
      socket.join(room);
      logger.info('Client subscribed to DAG events', { socketId: socket.id, dagId, room });
      return respond(true, { dagId, room });
    }

    case 'unsubscribe': {
      if (!dagId) return respond(false, undefined, 'Missing dagId parameter');
      const room = `dag:${dagId}`;
      socket.leave(room);
      logger.info('Client unsubscribed from DAG events', { socketId: socket.id, dagId, room });
      return respond(true, { dagId, room });
    }

    case 'help': {
      return respond(true, {
        commands: [
          { action: 'query', desc: 'Query DAG status', params: 'dagId? (optional, returns all if omitted)' },
          { action: 'stats', desc: 'Get system stats (DAG/scheduler/slots)' },
          { action: 'pause', desc: 'Pause DAG', params: 'dagId' },
          { action: 'resume', desc: 'Resume DAG', params: 'dagId, nodeId?' },
          { action: 'retry', desc: 'Retry DAG/node', params: 'dagId, nodeId?' },
          { action: 'cancel', desc: 'Cancel DAG', params: 'dagId' },
          { action: 'subscribe', desc: 'Subscribe to DAG events', params: 'dagId' },
          { action: 'unsubscribe', desc: 'Unsubscribe from DAG events', params: 'dagId' },
        ],
      });
    }

    default:
      return respond(false, undefined, `Unknown command: ${action}`);
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** DAG EventtypeList */
const DAG_EVENT_TYPES = [
  'dag:created',
  'dag:cancelled',
  'dag:completed',
  'dag:paused',
  'dag:resumed',
  'dag:nodeStateChanged',
  'dag:nodeCompleted',
  'dag:nodeFailed',
  'dag:nodeProgress',
  'dag:nodeRetrying',
  'dag:schedulingDecision',
  'dag:resourceAllocated',
  'dag:resourceReleased',
] as const;

function setupDagEventBridge(): void {
  for (const eventType of DAG_EVENT_TYPES) {
    eventBus.on(eventType, (payload) => {
      if (!io) return;

      const dagId = payload?.dagId;
      const eventMessage: ServerEvent = {
        type: eventType,
        payload,
        timestamp: new Date().toISOString(),
      };

      if (dagId) {
        io.to(`dag:${dagId}`).emit('dag:event', eventMessage);
      }

      io.to('dag:all').emit('dag:event', eventMessage);
    });
  }

  logger.info('DAG event bridge registered', { eventCount: DAG_EVENT_TYPES.length });
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Socket.IO Initialize
 * ─────────────────────────────────────────────────────────────────────────────
 */

export function initSocketIO(server: HTTPServer): void {
  io = new SocketIOServer(server, {
    transports: ['websocket', 'polling'],
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  if (!io) return;

  io.on('connection', (socket: Socket) => {
    const clientLogger = logger.child({ socketId: socket.id });
    clientLogger.info('Client connected');

    socket.on('dag:command', async (cmd: ClientCommand) => {
      const cmdLogger = clientLogger.child({
        traceId: cmd.requestId,
        action: cmd.action,
        dagId: cmd.dagId,
      });

      try {
        cmdLogger.info('Command received');
        const response = await runWithTraceContext(
          { traceId: cmd.requestId, dagId: cmd.dagId, nodeId: cmd.nodeId },
          () => handleCommand(socket, cmd),
        );
        socket.emit('dag:response', response);
        cmdLogger.info('Command processed', { success: response.success });
      } catch (err) {
        cmdLogger.error('Command processing failed', err);
        socket.emit('dag:response', {
          requestId: cmd.requestId,
          action: cmd.action,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        } satisfies ServerResponse);
      }
    });

    // ── Subscribeglobal DAG Event ────────────────────────────────────────
    socket.on('dag:subscribeAll', () => {
      socket.join('dag:all');
      clientLogger.info('Subscribed to global DAG events');
    });

    socket.on('dag:unsubscribeAll', () => {
      socket.leave('dag:all');
      clientLogger.info('Unsubscribed from global DAG events');
    });

    // ── DisconnectConnect ──────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      clientLogger.info('Client disconnected', { reason });
    });
  });

  // Register DAG EventBridge
  setupDagEventBridge();

  logger.info('Socket.IO server initialized');
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initSocketIO first.');
  }
  return io;
}

export function broadcastProgress(msg: ProgressMessage): void {
  if (!io) return;
  io.emit('progress', msg);
}

export function getConnectionStats(): {
  totalConnections: number;
  rooms: string[];
} {
  if (!io) return { totalConnections: 0, rooms: [] };
  const rooms = Array.from(io.sockets.adapter.rooms.keys());
  return {
    totalConnections: io.engine.clientsCount,
    rooms,
  };
}
