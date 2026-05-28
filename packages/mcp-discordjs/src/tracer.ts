/**
 * Request tracer for mcp-discordjs.
 * Generates and propagates UUID v4 correlation IDs through call chains.
 */

export interface TraceMark {
  name: string;
  timestamp: number;
  duration?: number;
}

export interface TraceContext {
  correlationId: string;
  marks: TraceMark[];
}

/**
 * Request tracer for generating and tracking correlation IDs.
 */
export class RequestTracer {
  private correlationId: string;
  private marks: TraceMark[] = [];
  private startTime: number;

  constructor(correlationId?: string) {
    this.correlationId = correlationId || this.generateUuid();
    this.startTime = Date.now();
  }

  /**
   * Generate a UUID v4 compatible string.
   */
  private generateUuid(): string {
    // Simple UUID v4 generation
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get the correlation ID for this trace.
   */
  getCorrelationId(): string {
    return this.correlationId;
  }

  /**
   * Record a named mark in the trace.
   */
  mark(name: string): void {
    this.marks.push({
      name,
      timestamp: Date.now(),
    });
  }

  /**
   * Record a named mark with a duration in milliseconds.
   */
  markWithDuration(name: string, durationMs: number): void {
    this.marks.push({
      name,
      timestamp: Date.now(),
      duration: durationMs,
    });
  }

  /**
   * Get all recorded marks.
   */
  getMarks(): TraceMark[] {
    return [...this.marks];
  }

  /**
   * Get the total elapsed time since tracer creation.
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get a summary of the trace.
   */
  getSummary(): TraceContext {
    return {
      correlationId: this.correlationId,
      marks: [...this.marks],
    };
  }

  /**
   * Create a child tracer with the same correlation ID.
   */
  child(): RequestTracer {
    const child = new RequestTracer(this.correlationId);
    child.marks = [...this.marks];
    child.startTime = this.startTime;
    return child;
  }
}

/**
 * Create a new trace with a fresh correlation ID.
 */
export function createTrace(): RequestTracer {
  return new RequestTracer();
}

/**
 * Create a trace from an existing correlation ID.
 */
export function createTraceFrom(correlationId: string): RequestTracer {
  return new RequestTracer(correlationId);
}