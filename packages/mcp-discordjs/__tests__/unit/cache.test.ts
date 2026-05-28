/**
 * Unit tests for Cache (ResultCache and DocCache).
 * Tests LRU eviction order, max size enforcement, TTL expiration, and eviction callbacks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ResultCache, DocCache, buildCacheKey } from "../../src/cache.js";

describe("ResultCache", () => {
  let cache: ResultCache<string, string>;

  beforeEach(() => {
    cache = new ResultCache<string, string>({
      maxSize: 3,
      ttl: 3600000, // 1 hour
    });
  });

  describe("basic operations", () => {
    it("stores and retrieves values", () => {
      cache.set("key1", "value1");
      
      expect(cache.get("key1")).toBe("value1");
    });

    it("returns undefined for missing keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("has returns true for existing keys", () => {
      cache.set("key1", "value1");
      
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("nonexistent")).toBe(false);
    });

    it("delete removes entries", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
      
      cache.delete("key1");
      
      expect(cache.has("key1")).toBe(false);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("clear removes all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      
      cache.clear();
      
      expect(cache.size).toBe(0);
      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
    });
  });

  describe("LRU eviction order", () => {
    it("evicts least recently used when max size is reached", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");
      
      // Access key1 to make it recently used
      cache.get("key1");
      
      // Add new entry, should evict key2 (least recently used)
      cache.set("key4", "value4");
      
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(false); // evicted
      expect(cache.has("key3")).toBe(true);
      expect(cache.has("key4")).toBe(true);
    });

    it("updates access time on get", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");
      
      // Access key1 and key2
      cache.get("key1");
      cache.get("key2");
      
      // Add new entry, should evict key3
      cache.set("key4", "value4");
      
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(false); // evicted
      expect(cache.has("key4")).toBe(true);
    });

    it("maintains correct order with mixed access", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      
      cache.get("a"); // a is now most recent
      cache.set("b", "2-updated"); // b was 2nd oldest, now accessed
      cache.set("d", "4"); // c is oldest, should be evicted
      
      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(false);
      expect(cache.has("d")).toBe(true);
    });
  });

  describe("max size enforcement", () => {
    it("respects custom max size", () => {
      const smallCache = new ResultCache<string, string>({ maxSize: 2 });
      
      smallCache.set("key1", "value1");
      smallCache.set("key2", "value2");
      smallCache.set("key3", "value3");
      
      expect(smallCache.size).toBe(2);
      expect(smallCache.has("key1")).toBe(false);
      expect(smallCache.has("key2")).toBe(true);
      expect(smallCache.has("key3")).toBe(true);
    });

    it("uses default max size of 100", () => {
      const defaultCache = new ResultCache<string, string>();
      
      // Add 100 entries
      for (let i = 0; i < 100; i++) {
        defaultCache.set(`key${i}`, `value${i}`);
      }
      
      expect(defaultCache.size).toBe(100);
      expect(defaultCache.has("key0")).toBe(true); // 100th entry is key99
      
      // Add one more
      defaultCache.set("key100", "value100");
      
      expect(defaultCache.size).toBe(100);
      expect(defaultCache.has("key0")).toBe(false); // key0 was evicted
      expect(defaultCache.has("key100")).toBe(true);
    });
  });

  describe("eviction callback", () => {
    it("increments eviction counter on cache eviction", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");
      
      // This should evict key1
      cache.set("key4", "value4");
      
      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it("counts multiple evictions", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");
      
      cache.set("key4", "value4"); // evicts key1
      cache.set("key5", "value5"); // evicts key2
      
      const stats = cache.getStats();
      expect(stats.evictions).toBe(2);
    });
  });

  describe("cache statistics", () => {
    it("tracks hits", () => {
      cache.set("key1", "value1");
      
      cache.get("key1"); // hit
      cache.get("key1"); // hit
      cache.get("nonexistent"); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it("tracks misses", () => {
      cache.set("key1", "value1");
      
      cache.get("nonexistent1"); // miss
      cache.get("nonexistent2"); // miss
      cache.get("key1"); // hit
      
      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it("calculates hit ratio", () => {
      cache.set("key1", "value1");
      
      cache.get("key1"); // hit
      cache.get("nonexistent"); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it("returns copy of stats", () => {
      cache.set("key1", "value1");
      cache.get("key1");
      
      const stats1 = cache.getStats();
      const stats2 = cache.getStats();
      
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe("TTL expiration", () => {
    it("respects TTL setting", async () => {
      const shortTtlCache = new ResultCache<string, string>({
        maxSize: 10,
        ttl: 50, // 50ms TTL
      });
      
      shortTtlCache.set("key1", "value1");
      
      // Should exist immediately
      expect(shortTtlCache.has("key1")).toBe(true);
      
      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));
      
      // Should be expired
      expect(shortTtlCache.has("key1")).toBe(false);
    });
  });

  describe("string key conversion", () => {
    it("handles non-string keys by converting to string", () => {
      cache.set(123 as unknown as string, "number key");
      
      expect(cache.get("123")).toBe("number key");
      expect(cache.has(123 as unknown as string)).toBe(true);
    });
  });
});

describe("DocCache", () => {
  let docCache: DocCache;

  beforeEach(() => {
    docCache = new DocCache(3, 3600000);
  });

  it("stores and retrieves typed values", () => {
    const testData = { name: "Test", methods: [] };
    docCache.set("test-key", testData);
    
    const retrieved = docCache.get<typeof testData>("test-key");
    expect(retrieved).toEqual(testData);
  });

  it("returns undefined for missing keys", () => {
    expect(docCache.get("nonexistent")).toBeUndefined();
  });

  it("shares stats with underlying cache", () => {
    docCache.set("key1", "value1");
    docCache.get("key1"); // hit
    docCache.get("missing"); // miss
    
    const stats = docCache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it("enforces max size", () => {
    docCache.set("key1", "value1");
    docCache.set("key2", "value2");
    docCache.set("key3", "value3");
    docCache.set("key4", "value4");
    
    expect(docCache.size).toBe(3);
    expect(docCache.has("key1")).toBe(false);
  });

  it("handles clear", () => {
    docCache.set("key1", "value1");
    docCache.set("key2", "value2");
    
    docCache.clear();
    
    expect(docCache.size).toBe(0);
    expect(docCache.has("key1")).toBe(false);
  });

  it("handles delete", () => {
    docCache.set("key1", "value1");
    
    const result = docCache.delete("key1");
    
    expect(result).toBe(true);
    expect(docCache.has("key1")).toBe(false);
  });
});

describe("buildCacheKey", () => {
  it("joins parts with colon", () => {
    expect(buildCacheKey("http", "https://example.com")).toBe("http:https://example.com");
    expect(buildCacheKey("html", "path", "to", "page")).toBe("html:path:to:page");
  });

  it("handles single part", () => {
    expect(buildCacheKey("single")).toBe("single");
  });

  it("handles empty parts", () => {
    expect(buildCacheKey("", "part2")).toBe(":part2");
    expect(buildCacheKey("part1", "")).toBe("part1:");
  });
});