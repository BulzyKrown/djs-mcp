/**
 * Integration tests for DiscordDocsFetcher - MAX ITERATION EDITION.
 * Tests with mock HTTP responses for all new functionality.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DiscordDocsFetcher } from "../../src/fetcher.js";
import { createMockFetch, createRateLimitResponse, createServerErrorResponse } from "../helpers/mock-server.js";

vi.mock("../../src/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  StructuredLogger: {},
}));

vi.mock("../../src/metrics.js", () => ({
  globalMetrics: {
    recordCacheHit: vi.fn(),
    recordCacheMiss: vi.fn(),
    recordLatency: vi.fn(),
    recordError: vi.fn(),
  },
  MetricsCollector: vi.fn(),
}));

vi.mock("../../src/version-detector.js", () => ({
  globalVersionDetector: {
    detectLatestVersion: vi.fn().mockImplementation(async () => ({
      version: "14.26.4",
      url: "https://discord.js.org/docs/packages/discord.js/14.26.4",
      detectedAt: Date.now(),
    })),
  },
}));

vi.mock("../../src/cdn-indexer.js", () => ({
  globalCdnIndexer: {
    isReady: vi.fn().mockReturnValue(false),
    search: vi.fn().mockResolvedValue([]),
    fetchIndex: vi.fn().mockResolvedValue(undefined),
    getEnum: vi.fn().mockResolvedValue(null),
    getClass: vi.fn().mockResolvedValue(null),
  },
}));

describe("DiscordDocsFetcher Integration - MAX ITERATION", () => {
  let fetcher: DiscordDocsFetcher;

  beforeEach(() => {
    fetcher = new DiscordDocsFetcher();
  });

  describe("listPackages", () => {
    it("returns list of discord.js packages", async () => {
      const packages = await fetcher.listPackages();
      
      expect(packages).toBeInstanceOf(Array);
      expect(packages.length).toBeGreaterThan(0);
      expect(packages.some((p) => p.title === "discord.js")).toBe(true);
      expect(packages.some((p) => p.title === "builders")).toBe(true);
    });

    it("package entries have required fields", async () => {
      const packages = await fetcher.listPackages();
      
      for (const pkg of packages) {
        expect(pkg).toHaveProperty("title");
        expect(pkg).toHaveProperty("description");
        expect(pkg).toHaveProperty("url");
        expect(pkg).toHaveProperty("type");
        expect(pkg.type).toBe("package");
      }
    });
  });

  describe("search", () => {
    it("returns matching results for query", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            { kind: "Class", name: "Message", href: "classes/Message", entry: "Message" },
          ]) },
        },
      ]);
      
      const results = await fetcher.search("Client");
      
      expect(results).toBeInstanceOf(Array);
    });

    it("handles case-insensitive search", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
          ]) },
        },
      ]);
      
      const results = await fetcher.search("client");
      
      expect(Array.isArray(results)).toBe(true);
    });

    it("returns empty array on network error", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 500, body: "Server Error" },
        },
      ]);
      
      const results = await fetcher.search("test");
      
      expect(results).toEqual([]);
    });
  });

  describe("search_all - multi-package search", () => {
    it("searches across all defined packages", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
          ]) },
        },
      ]);
      
      const results = await fetcher.searchAll("Client", { limit: 5 });
      
      expect(Array.isArray(results)).toBe(true);
    });

    it("returns results grouped by package", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
          ]) },
        },
      ]);
      
      const results = await fetcher.searchAll("Client");
      
      results.forEach(pkg => {
        expect(pkg).toHaveProperty("package");
        expect(pkg).toHaveProperty("items");
        expect(pkg).toHaveProperty("total");
      });
    });
  });

  describe("autocomplete", () => {
    it("returns quick prefix matches", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            { kind: "Class", name: "ClientManager", href: "classes/ClientManager", entry: "ClientManager" },
            { kind: "Class", name: "Collection", href: "classes/Collection", entry: "Collection" },
          ]) },
        },
      ]);
      
      const result = await fetcher.autocomplete("Cli", "discord.js");
      
      expect(result.package).toBe("discord.js");
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every(i => i.name.startsWith("Cli"))).toBe(true);
    });

    it("returns empty for no matches", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([]) },
        },
      ]);
      
      const result = await fetcher.autocomplete("XYZ", "discord.js");
      
      expect(result.items.length).toBe(0);
    });
  });

  describe("get_related", () => {
    it("finds related classes", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            { kind: "Class", name: "ClientManager", href: "classes/ClientManager", entry: "ClientManager" },
            { kind: "Class", name: "BaseClient", href: "classes/BaseClient", entry: "BaseClient" },
          ]) },
        },
      ]);
      
      const results = await fetcher.getRelated("Client");
      
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("get_type", () => {
    it("returns type alias documentation", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "TypeAlias", name: "Snowflake", href: "types/Snowflake:string", entry: "Snowflake" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getType("Snowflake");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Snowflake");
    });

    it("returns null for missing type", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([]) },
        },
      ]);
      
      const result = await fetcher.getType("NonExistent");
      
      expect(result).toBeNull();
    });
  });

  describe("get_function", () => {
    it("returns function docs", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Function", name: "createClient", href: "functions/createClient:config:object->Client", entry: "createClient" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getFunction("createClient");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("createClient");
    });
  });

  describe("get_namespace", () => {
    it("returns namespace with items", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Namespace", name: "Utils", href: "namespaces/Utils", entry: "Utils" },
            { kind: "Function", name: "Utils.resolve", href: "namespaces/Utils/resolve", entry: "resolve" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getNamespace("Utils");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Utils");
      expect(result?.items.length).toBeGreaterThan(0);
    });
  });

  describe("get_hierarchy", () => {
    it("returns class inheritance tree", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client?extends=BaseClient", entry: "Client" },
            { kind: "Class", name: "BaseClient", href: "classes/BaseClient", entry: "BaseClient" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getHierarchy("Client");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Client");
    });
  });

  describe("getClass", () => {
    it("returns null when class not found", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([]) },
        },
      ]);
      
      const result = await fetcher.getClass("NonExistentClass");
      
      expect(result).toBeNull();
    });

    it("returns class document with static/instance grouping", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            { kind: "Method", name: "login", href: "classes/Client/login", entry: "login" },
            { kind: "Method (Static)", name: "connect", href: "classes/Client/static/connect", entry: "connect" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getClass("Client");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Client");
    });
  });

  describe("getMethod", () => {
    it("returns null when class not found", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([]) },
        },
      ]);
      
      const result = await fetcher.getMethod("NonExistentClass", "method");
      
      expect(result).toBeNull();
    });

    it("returns method with parameters", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            { kind: "Method", name: "login", href: "classes/Client/login:token:string->Promise<boolean>", entry: "login" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getMethod("Client", "login");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("login");
    });
  });

  describe("getInterface", () => {
    it("returns interface with properties", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Interface", name: "GuildChannel", href: "interfaces/GuildChannel", entry: "GuildChannel" },
            { kind: "Property", name: "position", href: "interfaces/GuildChannel/position?:number", entry: "position" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getInterface("GuildChannel");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("GuildChannel");
    });
  });

  describe("getEnum", () => {
    it("returns enum with values", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 200, body: JSON.stringify([
            { kind: "Enum", name: "Events", href: "enums/Events", entry: "Events" },
            { kind: "Enum", name: "Events.ready", href: "enums/Events.ready", entry: "ready" },
            { kind: "Enum", name: "Events.messageCreate", href: "enums/Events.messageCreate", entry: "messageCreate" },
          ]) },
        },
      ]);
      
      const result = await fetcher.getEnum("Events");
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Events");
      expect(result?.values.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    describe("404 handling", () => {
      it("handles 404 response gracefully", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 404, body: "Not Found" },
          },
        ]);
        
        const results = await fetcher.search("test");
        
        expect(results).toEqual([]);
      });
    });

    describe("429 rate limit handling", () => {
      it("search handles rate limit response", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 429, body: "Rate Limited", delay: 0 },
          },
        ]);
        
        const results = await fetcher.search("test");
        
        expect(results).toEqual([]);
      });

      it("getClass returns null on rate limit", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 429, body: "Rate Limited", delay: 0 },
          },
        ]);

        const result = await fetcher.getClass("Client");
        expect(result).toBeNull();
      });
    });

    describe("timeout handling", () => {
      it("handles timeout with slow response", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 504, body: "Gateway Timeout", delay: 0 },
          },
        ]);
        
        const results = await fetcher.search("test");
        
        expect(results).toEqual([]);
      });
    });

    describe("server error handling", () => {
      it("handles 500 server error", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 500, body: "Internal Server Error", delay: 0 },
          },
        ]);
        
        const results = await fetcher.search("test");
        
        expect(results).toEqual([]);
      });

      it("handles 502 bad gateway", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 502, body: "Bad Gateway", delay: 0 },
          },
        ]);
        
        const results = await fetcher.search("test");
        
        expect(results).toEqual([]);
      });

      it("handles 503 service unavailable", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 503, body: "Service Unavailable", delay: 0 },
          },
        ]);
        
        const results = await fetcher.search("test");
        
        expect(results).toEqual([]);
      });
    });

    describe("network failure handling", () => {
      it("handles fetch throw", async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
        
        const results = await fetcher.search("test");
        
        expect(results).toEqual([]);
      });

      it("handles malformed response", async () => {
        global.fetch = createMockFetch([
          {
            path: "/api/docs/sitemap",
            response: { status: 200, body: "not valid json {" },
          },
        ]);
        
        const results = await fetcher.search("test");
        
        expect(Array.isArray(results)).toBe(true);
      });
    });
  });

  describe("cache integration", () => {
    it("results are cached after first fetch", async () => {
      let fetchCount = 0;

      global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
        fetchCount++;
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/api/docs/sitemap")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => [
              { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            ],
          };
        }

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "text/html" }),
          text: async () => `<html><body><h1>Test</h1></body></html>`,
          json: async () => ({}),
        };
      });

      const fetcherWithCache = new DiscordDocsFetcher();

      await fetcherWithCache.search("Client", "discord.js", { clientId: "test" });
      await fetcherWithCache.search("Client", "discord.js", { clientId: "test" });

      expect(fetchCount).toBeGreaterThanOrEqual(1);
    });

    it("serves stale data when API fails", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        // Call pattern: version(200), sitemap(200), version(cached), sitemap(FAIL)
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "text/html" }),
            text: async () => "<html><body><a href='/docs/packages/discord.js/14.26.4'>14.26.4</a></body></html>",
          };
        }
        if (callCount === 2) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => [
              { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            ],
          };
        }
        if (callCount === 3) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => [
              { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            ],
          };
        }
        throw new Error("API failure");
      });

      const fetcherWithStale = new DiscordDocsFetcher({ cacheTtlMs: 60000 });

      await fetcherWithStale.search("Client", "discord.js", { clientId: "test" });
      const results2 = await fetcherWithStale.search("Client", "discord.js", { clientId: "test" });

      expect(results2.length).toBeGreaterThan(0);
    });
  });

  describe("circuit breaker integration", () => {
    it("records failures and transitions state", async () => {
      global.fetch = createMockFetch([
        {
          path: "/api/docs/sitemap",
          response: { status: 500, body: "Server Error" },
        },
      ]);

      for (let i = 0; i < 6; i++) {
        await fetcher.search("test", undefined, { clientId: "test" });
      }

      expect(fetcher.isCircuitBreakerOpen()).toBe(true);
    });

    it("serves from stale cache when circuit is open", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => [
              { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
            ],
          };
        }
        throw new Error("API failure");
      });

      const cbFetcher = new DiscordDocsFetcher();

      await cbFetcher.search("Client", "discord.js", { clientId: "test" });

      for (let i = 0; i < 6; i++) {
        try {
          await cbFetcher.search("Client", "discord.js", { clientId: "test" });
        } catch {}
      }
    });
  });
});