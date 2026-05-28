/**
 * Structured logger for mcp-discordjs.
 * Uses pino with JSON output in production and simple pretty output in development.
 * Logs to stderr only to avoid interfering with MCP protocol on stdout.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Pretty print log for development mode - outputs to stderr.
 * Simple implementation to avoid CJS/ESM issues with pino-pretty.
 */
function prettyPrint(level: LogLevel, message: string, meta: Record<string, unknown>): void {
  const timestamp = new Date().toISOString().split("T")[1]?.slice(0, -1) || new Date().toISOString();
  const levelStr = level.toUpperCase().padEnd(5, " ");
  const corrId = meta.correlationId ? `[${meta.correlationId}] ` : "";

  const metaStr = Object.keys(meta)
    .filter(k => k !== "correlationId" && k !== "error")
    .map(k => `${k}=${JSON.stringify(meta[k])}`)
    .join(" ");

  const errorStr = meta.error
    ? `\n  ${(meta.error as { message?: string }).message || String(meta.error)}`
    : "";

  const line = `${timestamp} ${levelStr} ${corrId}${message} ${metaStr}${errorStr}`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "info") {
    console.info(line);
  } else {
    console.log(line);
  }
}

/**
 * Logger interface - works in both dev and prod modes.
 */
export const logger = {
  error: (meta: Record<string, unknown>, msg: string) => {
    if (isDevelopment) {
      prettyPrint("error", msg, meta);
    } else {
      console.error(JSON.stringify({ level: "error", time: Date.now(), msg, ...meta }));
    }
  },
  warn: (meta: Record<string, unknown>, msg: string) => {
    if (isDevelopment) {
      prettyPrint("warn", msg, meta);
    } else {
      console.warn(JSON.stringify({ level: "warn", time: Date.now(), msg, ...meta }));
    }
  },
  info: (meta: Record<string, unknown>, msg: string) => {
    if (isDevelopment) {
      prettyPrint("info", msg, meta);
    } else {
      console.info(JSON.stringify({ level: "info", time: Date.now(), msg, ...meta }));
    }
  },
  debug: (meta: Record<string, unknown>, msg: string) => {
    if (isDevelopment) {
      prettyPrint("debug", msg, meta);
    } else {
      console.log(JSON.stringify({ level: "debug", time: Date.now(), msg, ...meta }));
    }
  },
};

export class StructuredLogger {
  private correlationId: string | undefined;

  constructor(correlationId?: string) {
    this.correlationId = correlationId;
  }

  withCorrelationId(correlationId: string): StructuredLogger {
    return new StructuredLogger(correlationId);
  }

  withContext(context: LogContext): StructuredLogger {
    const child = new StructuredLogger(this.correlationId);
    return child;
  }

  error(error: Error | unknown, message: string, context?: LogContext): void {
    const meta = {
      ...context,
      correlationId: this.correlationId,
      error: error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : String(error),
    };
    logger.error(meta, message);
  }

  warn(message: string, context?: LogContext): void {
    logger.warn({ ...context, correlationId: this.correlationId }, message);
  }

  info(message: string, context?: LogContext): void {
    logger.info({ ...context, correlationId: this.correlationId }, message);
  }

  debug(message: string, context?: LogContext): void {
    logger.debug({ ...context, correlationId: this.correlationId }, message);
  }

  getCorrelationId(): string | undefined {
    return this.correlationId;
  }
}

export function createLogger(correlationId?: string): StructuredLogger {
  return new StructuredLogger(correlationId);
}