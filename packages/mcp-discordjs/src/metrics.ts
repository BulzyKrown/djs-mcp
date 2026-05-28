/**
 * Metrics collector for mcp-discordjs observability.
 * Tracks cache hit/miss ratio, request latency, and error counts by type.
 */

export interface MetricsSnapshot {
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  requestLatency: LatencyStats;
  errorsByType: Record<string, number>;
  totalRequests: number;
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Metrics collector for observability.
 */
export class MetricsCollector {
  private cacheHits = 0;
  private cacheMisses = 0;
  private totalRequests = 0;
  private errorsByType: Record<string, number> = {};
  private latencies: number[] = [];
  private readonly maxLatencySamples = 1000;

  /**
   * Record a cache hit.
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record a cache miss.
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Record a request latency in milliseconds.
   */
  recordLatency(latencyMs: number): void {
    this.totalRequests++;
    this.latencies.push(latencyMs);
    if (this.latencies.length > this.maxLatencySamples) {
      this.latencies = this.latencies.slice(-this.maxLatencySamples);
    }
  }

  /**
   * Record an error by type code.
   */
  recordError(type: string): void {
    this.errorsByType[type] = (this.errorsByType[type] || 0) + 1;
  }

  /**
   * Get a snapshot of current metrics.
   */
  getSnapshot(): MetricsSnapshot {
    const total = this.cacheHits + this.cacheMisses;
    const cacheHitRatio = total > 0 ? this.cacheHits / total : 0;

    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio,
      requestLatency: this.calculateLatencyStats(),
      errorsByType: { ...this.errorsByType },
      totalRequests: this.totalRequests,
    };
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.totalRequests = 0;
    this.errorsByType = {};
    this.latencies = [];
  }

  /**
   * Calculate latency statistics.
   */
  private calculateLatencyStats(): LatencyStats {
    if (this.latencies.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      mean: sum / count,
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
    };
  }

  /**
   * Calculate percentile from sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }
}

/**
 * Global metrics instance for shared observability.
 */
export const globalMetrics = new MetricsCollector();