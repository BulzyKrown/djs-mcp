/**
 * Circuit breaker pattern implementation.
 * Protects against cascade failures by stopping requests when failures exceed threshold.
 */

export enum CircuitState {
  Closed = "closed",
  Open = "open",
  HalfOpen = "half-open",
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting recovery (default: 60000) */
  resetTimeout: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60000,
};

export class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Check if the circuit allows requests.
   */
  canRequest(): boolean {
    this.checkStateTransition();
    return this.state !== CircuitState.Open;
  }

  /**
   * Record a successful operation.
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HalfOpen) {
      // Successful call in half-open state closes the circuit
      this.reset();
    } else if (this.state === CircuitState.Closed) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed operation.
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.Closed) {
      if (this.failureCount >= this.config.failureThreshold) {
        this.state = CircuitState.Open;
      }
    } else if (this.state === CircuitState.HalfOpen) {
      // Failure in half-open state means recovery failed, go back to open
      this.state = CircuitState.Open;
    }
    // In Open state, failures keep it open (no change needed)
  }

  /**
   * Check and perform state transitions based on timeout.
   */
  private checkStateTransition(): void {
    if (this.state === CircuitState.Open && this.lastFailureTime !== null) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeout) {
        this.state = CircuitState.HalfOpen;
      }
    }
  }

  /**
   * Reset the circuit breaker to closed state.
   */
  reset(): void {
    this.state = CircuitState.Closed;
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Execute an operation with circuit breaker protection.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.canRequest()) {
      throw new Error("Circuit breaker is open");
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Get current statistics.
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    lastFailure: number | null;
  } {
    return {
      state: this.state,
      failures: this.failureCount,
      lastFailure: this.lastFailureTime,
    };
  }
}