/**
 * Typed error hierarchy for mcp-discordjs.
 * All errors are typed and traceable for proper error handling.
 */

export abstract class TypedError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

/**
 * Network-related errors (HTTP failures, timeouts, DNS).
 */
export class NetworkError extends TypedError {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "NETWORK_ERROR", { status, url, ...context });
  }
}

/**
 * Scraping/parsing errors (invalid selectors, malformed HTML).
 */
export class ScrapingError extends TypedError {
  constructor(
    message: string,
    public readonly selector?: string,
    public readonly url?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "SCRAPING_ERROR", { selector, url, ...context });
  }
}

/**
 * Cache-related errors (lookup failures, storage errors).
 */
export class CacheError extends TypedError {
  constructor(
    message: string,
    public readonly key?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "CACHE_ERROR", { key, ...context });
  }
}

/**
 * Rate limiting errors (429 Too Many Requests).
 */
export class RateLimitError extends TypedError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    context?: Record<string, unknown>
  ) {
    super(message, "RATE_LIMIT_ERROR", { retryAfter, ...context });
  }
}