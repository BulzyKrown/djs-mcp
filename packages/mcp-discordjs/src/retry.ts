/**
 * Retry utility with exponential backoff for resilient operations.
 */

import { Result, ok, err } from "./result.js";
import { NetworkError, RateLimitError } from "./errors.js";

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  attempts: number;
  /** Base delay in milliseconds (default: 200) */
  baseDelay: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelay: number;
  /** Backoff base (default: 2) */
  backoffBase: number;
  /** Enable jitter (default: true) */
  jitter: boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  attempts: 3,
  baseDelay: 200,
  maxDelay: 10000,
  backoffBase: 2,
  jitter: true,
};

/**
 * Check if an error is retryable (network or rate limit).
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof Error) {
    // Network errors in fetch
    if (error.message.includes("fetch") || error.message.includes("network")) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffBase, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);

  if (config.jitter) {
    // Random jitter between 0.5x and 1.5x of the delay
    return cappedDelay * (0.5 + Math.random());
  }

  return cappedDelay;
}

/**
 * Sleep for a given duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fallible async operation with exponential backoff.
 * Returns a Result to allow explicit error handling.
 */
export async function retry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<Result<T, Error>> {
  const fullConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < fullConfig.attempts; attempt++) {
    try {
      const value = await operation();
      return ok(value);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt
      if (attempt === fullConfig.attempts - 1) {
        break;
      }

      // Check if error is retryable
      if (!isRetryable(error)) {
        return err(lastError);
      }

      // Calculate and apply delay
      const delay = calculateDelay(attempt, fullConfig);
      await sleep(delay);
    }
  }

  return err(lastError ?? new Error("Retry exhausted"));
}