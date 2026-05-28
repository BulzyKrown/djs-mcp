/**
 * Sliding window rate limiter.
 * Tracks requests per IP with 10 requests per minute limit.
 */

import { NetworkError } from "./errors.js";
import { logger } from "./logger.js";

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

interface RequestRecord {
  timestamps: number[];
}

/**
 * Sliding window rate limiter using in-memory Map.
 * Protects discord.js.org from excessive requests.
 */
export class RateLimiter {
  private records: Map<string, RequestRecord> = new Map();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxRequests: 10, windowMs: 60000 }) {
    this.config = config;
  }

  /**
   * Check if request is allowed and record it.
   */
  check(ip: string): RateLimitInfo {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get or create record for IP
    let record = this.records.get(ip);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(ip, record);
    }

    // Remove timestamps outside the window
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    // Check if under limit
    if (record.timestamps.length < this.config.maxRequests) {
      record.timestamps.push(now);
      const remaining = this.config.maxRequests - record.timestamps.length;

      return {
        allowed: true,
        remaining: Math.max(0, remaining - 1),
        resetAt: windowStart + this.config.windowMs,
      };
    }

    // Rate limited - return retry info
    const oldestTimestamp = record.timestamps[0];
    const retryAfterMs = oldestTimestamp + this.config.windowMs - now;

    return {
      allowed: false,
      remaining: 0,
      resetAt: oldestTimestamp + this.config.windowMs,
      retryAfterMs: Math.max(0, retryAfterMs),
    };
  }

  /**
   * Wrap an async operation with rate limiting.
   * Throws RateLimitError if rate limited.
   */
  async withLimit<T>(ip: string, operation: () => Promise<T>): Promise<T> {
    const info = this.check(ip);

    if (!info.allowed) {
      logger.warn({}, `Rate limit exceeded for IP: ${ip}`);
      throw new NetworkError(
        `Rate limit exceeded. Retry after ${Math.ceil((info.retryAfterMs || 0) / 1000)}s`,
        429
      );
    }

    return operation();
  }

  /**
   * Get rate limit headers for HTTP responses.
   */
  getHeaders(info: RateLimitInfo): Record<string, string> {
    return {
      "X-RateLimit-Limit": String(this.config.maxRequests),
      "X-RateLimit-Remaining": String(info.remaining),
      "X-RateLimit-Reset": String(Math.ceil(info.resetAt / 1000)),
      ...(info.retryAfterMs
        ? { "Retry-After": String(Math.ceil(info.retryAfterMs / 1000)) }
        : {}),
    };
  }

  /**
   * Clean up old records (call periodically).
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [ip, record] of this.records.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
      if (record.timestamps.length === 0) {
        this.records.delete(ip);
      }
    }
  }

  /**
   * Get current record count (for metrics).
   */
  get size(): number {
    return this.records.size;
  }
}

/**
 * Global rate limiter instance.
 * Limits to 10 requests per minute per IP.
 */
export const globalRateLimiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 60000,
});