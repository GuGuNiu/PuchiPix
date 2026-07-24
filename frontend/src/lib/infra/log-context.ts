/**
 * Structured context carried by every log entry.
 *
 * Populated by the DAG orchestrator (dagId, nodeId, taskType, phase)
 * and the trace propagation system (traceId). Extra fields carry
 * arbitrary key-value metadata for CLI queries and API filters.
 */
export interface LogContext {
  /** Distributed trace ID, auto-generated and propagated across async boundaries */
  traceId?: string;
  /** DAG instance ID (e.g. "gallery-42") */
  dagId?: string;
  /** DAG node ID (e.g. "scrape", "download", "zip") */
  nodeId?: string;
  /** Task type identifier (e.g. "gallery", "sniff", "ouo") */
  taskType?: string;
  /** Execution phase (e.g. "scrape", "download", "zip", "verify") */
  phase?: string;
  /** Arbitrary extra metadata for CLI queries and custom filters */
  [key: string]: unknown;
}

/**
 * Merge context objects: fields from `other` override `base`.
 * Returns a new object; neither input is mutated.
 */
export function mergeContext(base: LogContext, other: LogContext): LogContext {
  return { ...base, ...other };
}

/**
 * Return true if the context carries no trace or task data.
 */
export function isContextEmpty(ctx: LogContext): boolean {
  return (
    !ctx.traceId && !ctx.dagId && !ctx.nodeId && !ctx.taskType && !ctx.phase
  );
}

/**
 * Extract known context keys into an ordered array of "key=value" strings
 * for human-readable console output. Extra keys appear after known keys.
 */
export function formatContextPairs(ctx: LogContext): string[] {
  const pairs: string[] = [];
  const seen = new Set<string>();

  const add = (key: string, value: string | undefined) => {
    if (value) {
      pairs.push(`${key}=${value}`);
      seen.add(key);
    }
  };

  add("trace", ctx.traceId);
  add("dag", ctx.dagId);
  add("node", ctx.nodeId);
  add("type", ctx.taskType);
  add("phase", ctx.phase);

  for (const [k, v] of Object.entries(ctx)) {
    if (!seen.has(k) && v != null) {
      pairs.push(`${k}=${String(v)}`);
    }
  }

  return pairs;
}
