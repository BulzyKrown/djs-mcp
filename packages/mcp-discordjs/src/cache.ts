/**
 * LRU Cache implementation for mcp-discordjs.
 * Bounded cache with TTL support and eviction tracking.
 */

import LRUCache from "lru-cache";

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export interface CacheConfig {
  /** Maximum number of entries (default: 100) */
  maxSize: number;
  /** Time to live in milliseconds (default: 1 hour) */
  ttl: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxSize: 100,
  ttl: 3600000, // 1 hour
};

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

/**
 * LRU Cache wrapped for Result types with TTL support.
 */
export class ResultCache<K, V> {
  private cache: LRUCache<string, CacheEntry<V>>;
  private readonly config: CacheConfig;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.cache = new LRUCache({
      max: this.config.maxSize,
      ttl: this.config.ttl,
      updateAgeOnHas: false,
      updateAgeOnGet: true,
      disposeAfter: (_value: CacheEntry<V>, _key: string, _reason: string) => {
        this.stats.evictions++;
      },
    });
  }

  /**
   * Get a value from cache.
   */
  get(key: K): V | undefined {
    const stringKey = String(key);
    const entry = this.cache.get(stringKey);
    if (entry === undefined) {
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache.
   */
  set(key: K, value: V): void {
    const stringKey = String(key);
    this.cache.set(stringKey, { value, timestamp: Date.now() });
    this.stats.size = this.cache.size;
  }

  /**
   * Check if key exists in cache (without updating access time).
   */
  has(key: K): boolean {
    return this.cache.has(String(key));
  }

  /**
   * Delete a specific key from cache.
   */
  delete(key: K): boolean {
    const result = this.cache.delete(String(key));
    this.stats.size = this.cache.size;
    return result;
  }

  /**
   * Clear all entries from cache.
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get the current number of entries.
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Specialized cache for Discord documentation results.
 */
export class DocCache {
  private cache: ResultCache<string, unknown>;

  constructor(maxSize = 100, ttl = 3600000) {
    this.cache = new ResultCache<string, unknown>({ maxSize, ttl });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): CacheStats {
    return this.cache.getStats();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Cache key builder for consistent key generation.
 */
export function buildCacheKey(...parts: string[]): string {
  return parts.join(":");
}