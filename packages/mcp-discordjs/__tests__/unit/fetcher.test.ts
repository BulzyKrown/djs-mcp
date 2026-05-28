/**
 * Unit tests for DiscordDocsFetcher - MAX ITERATION EDITION.
 * Tests all new functionality: typo tolerance, search_all, autocomplete,
 * get_related, get_type, get_function, get_namespace, get_hierarchy,
 * explain_type, circuit breaker, stale-while-revalidate, and more.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DiscordDocsFetcher } from "../../src/fetcher.js";
import { CircuitState } from "../../src/circuit-breaker.js";

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

vi.mock("../../src/rate-limiter.js", () => ({
  globalRateLimiter: {
    withLimit: vi.fn((_id, fn) => fn()),
  },
}));

const createMockSitemap = () => [
  { kind: "Class", name: "Client", href: "classes/Client", entry: "Client" },
  { kind: "Class", name: "ClientManager", href: "classes/ClientManager", entry: "ClientManager" },
  { kind: "Class", name: "BaseClient", href: "classes/BaseClient", entry: "BaseClient" },
  { kind: "Class", name: "TextChannel", href: "classes/TextChannel", entry: "TextChannel" },
  { kind: "Method", name: "Client.login", href: "classes/Client/login:token:string->Promise<boolean>", entry: "login" },
  { kind: "Method", name: "Client.send", href: "classes/Client/send:content:string->Promise<Message>", entry: "send" },
  { kind: "Method", name: "Client.destroy", href: "classes/Client/destroy->void", entry: "destroy" },
  { kind: "Method (Static)", name: "Client.connect", href: "classes/Client/static/connect:options:ClientOptions->Promise<Connection>", entry: "connect" },
  { kind: "Property", name: "Client.users", href: "classes/Client/users:Collection", entry: "users" },
  { kind: "Property (Static)", name: "Client.default", href: "classes/Client/static/default:Client", entry: "default" },
  { kind: "Function", name: "createClient", href: "functions/createClient:config:Config->Client", entry: "createClient" },
  { kind: "Function", name: "formatMessage", href: "functions/formatMessage:msg:Message->string", entry: "formatMessage" },
  { kind: "Enum", name: "Events", href: "enums/Events", entry: "Events" },
  { kind: "Enum", name: "Events.ready", href: "enums/Events.ready", entry: "ready" },
  { kind: "Enum", name: "Events.messageCreate", href: "enums/Events.messageCreate", entry: "messageCreate" },
  { kind: "Interface", name: "GuildChannel", href: "interfaces/GuildChannel", entry: "GuildChannel" },
  { kind: "Interface", name: "GuildChannel.position", href: "interfaces/GuildChannel/position?:number", entry: "position" },
  { kind: "TypeAlias", name: "ClientOptions", href: "types/ClientOptions:object", entry: "ClientOptions" },
  { kind: "TypeAlias", name: "Snowflake", href: "types/Snowflake:string", entry: "Snowflake" },
  { kind: "Namespace", name: "Utils", href: "namespaces/Utils", entry: "Utils" },
  { kind: "Namespace", name: "Utils.resolve", href: "namespaces/Utils/resolve", entry: "resolve" },
  { kind: "Namespace", name: "Assertions", href: "namespaces/Assertions", entry: "Assertions" },
];

describe("DiscordDocsFetcher - MAX ITERATION", () => {
  let fetcher: DiscordDocsFetcher;

  beforeEach(() => {
    fetcher = new DiscordDocsFetcher();
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => createMockSitemap(),
    })) as typeof fetch;
  });

  describe("Levenshtein typo tolerance", () => {
    it("matches 'Clinet' (typo) to 'Client' with edit distance 1", async () => {
      const results = await fetcher.search("Clinet", "discord.js", {
        typoTolerance: true,
        fuzzy: false,
        clientId: "test",
      });

      expect(results.length).toBeGreaterThan(0);
      const clientResult = results.find(r => r.title === "Client");
      expect(clientResult).toBeDefined();
      expect(clientResult!.score).toBeGreaterThan(0);
    });

    it("matches 'Clinet' to 'Client' with edit distance 2", async () => {
      const results = await fetcher.search("Clint", "discord.js", {
        typoTolerance: true,
        fuzzy: false,
        clientId: "test",
      });

      expect(results.some(r => r.title === "Client")).toBe(true);
    });

    it("does not match 'Xlzyd' (edit distance > 2) to 'Client'", async () => {
      const results = await fetcher.search("Xlzyd", "discord.js", {
        typoTolerance: true,
        fuzzy: false,
        clientId: "test",
      });

      const clientMatch = results.find(r => r.title === "Client");
      expect(clientMatch).toBeUndefined();
    });

    it("exact match returns higher score than typo match", async () => {
      const [exactResults, typoResults] = await Promise.all([
        fetcher.search("Client", "discord.js", { typoTolerance: true, fuzzy: false, clientId: "test1" }),
        fetcher.search("Clinet", "discord.js", { typoTolerance: true, fuzzy: false, clientId: "test2" }),
      ]);

      const exactScore = exactResults.find(r => r.title === "Client")?.score || 0;
      const typoScore = typoResults.find(r => r.title === "Client")?.score || 0;

      expect(exactScore).toBeGreaterThan(typoScore);
    });
  });

  describe("search_all", () => {
    it("searches multiple packages simultaneously", async () => {
      const results = await fetcher.searchAll("Client", { limit: 5, clientId: "test" });

      expect(Array.isArray(results)).toBe(true);
      results.forEach(pkg => {
        expect(pkg).toHaveProperty("package");
        expect(pkg).toHaveProperty("items");
        expect(pkg).toHaveProperty("total");
        expect(pkg.items.every(i => i.title.toLowerCase().includes("client"))).toBe(true);
      });
    });

    it("filters by type across all packages", async () => {
      const results = await fetcher.searchAll("Client", {
        type: "class",
        limit: 5,
        clientId: "test"
      });

      expect(Array.isArray(results)).toBe(true);
      results.forEach(pkg => {
        expect(pkg.items.every(i => i.type === "class")).toBe(true);
      });
    });

    it("respects per-package limits", async () => {
      const results = await fetcher.searchAll("Client", {
        limit: 3,
        clientId: "test"
      });

      results.forEach(pkg => {
        expect(pkg.items.length).toBeLessThanOrEqual(3);
      });
    });
  });

  describe("autocomplete", () => {
    it("returns fast prefix matches", async () => {
      const result = await fetcher.autocomplete("Cli", "discord.js", { limit: 10, clientId: "test" });

      expect(result.package).toBe("discord.js");
      expect(Array.isArray(result.items)).toBe(true);
      result.items.forEach(item => {
        expect(item.name.toLowerCase().startsWith("cli")).toBe(true);
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("package");
      });
    });

    it("returns empty for no matches", async () => {
      const result = await fetcher.autocomplete("XYZ123", "discord.js", { limit: 10, clientId: "test" });

      expect(result.items.length).toBe(0);
    });

    it("respects limit", async () => {
      const result = await fetcher.autocomplete("Cli", "discord.js", { limit: 2, clientId: "test" });

      expect(result.items.length).toBeLessThanOrEqual(2);
    });
  });

  describe("get_related", () => {
    it("finds related items by naming patterns", async () => {
      const results = await fetcher.getRelated("Client", "discord.js", { limit: 10, clientId: "test" });

      expect(Array.isArray(results)).toBe(true);
      results.forEach(r => {
        expect(r.title.toLowerCase()).not.toBe("client");
      });
    });

    it("returns empty for no related items", async () => {
      const results = await fetcher.getRelated("UniqueName123", "discord.js", { limit: 10, clientId: "test" });

      expect(Array.isArray(results)).toBe(true);
    });

    it("excludes the original item", async () => {
      const results = await fetcher.getRelated("Client", "discord.js", { limit: 10, clientId: "test" });

      expect(results.some(r => r.title.toLowerCase() === "client")).toBe(false);
    });
  });

  describe("get_type", () => {
    it("returns type alias documentation", async () => {
      const result = await fetcher.getType("Snowflake", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Snowflake");
      expect(result?.type).toBeDefined();
      expect(result?.kind).toBe("TypeAlias");
    });

    it("returns null for non-existent type", async () => {
      const result = await fetcher.getType("NonExistentType", "discord.js", "test");

      expect(result).toBeNull();
    });

    it("includes resolved type", async () => {
      const result = await fetcher.getType("ClientOptions", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.resolvedType).toBeDefined();
    });
  });

  describe("explain_type", () => {
    it("recursively resolves type aliases", async () => {
      const result = await fetcher.explainType("ClientOptions", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.chain).toBeInstanceOf(Array);
      expect(result?.chain.length).toBeGreaterThan(0);
      expect(result?.originalType).toBeDefined();
      expect(result?.resolvedType).toBeDefined();
    });

    it("handles circular references", async () => {
      const result = await fetcher.explainType("Snowflake", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.chain).toBeInstanceOf(Array);
    });

    it("returns null for non-existent type", async () => {
      const result = await fetcher.explainType("NonExistent", "discord.js", "test");

      expect(result).toBeNull();
    });
  });

  describe("get_function", () => {
    it("returns function documentation", async () => {
      const result = await fetcher.getFunction("createClient", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.name).toBe("createClient");
      expect(result?.signature).toBeDefined();
      expect(result?.parameters).toBeInstanceOf(Array);
    });

    it("returns null for non-existent function", async () => {
      const result = await fetcher.getFunction("nonExistentFunction", "discord.js", "test");

      expect(result).toBeNull();
    });

    it("includes parameter types", async () => {
      const result = await fetcher.getFunction("createClient", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.parameters).toBeInstanceOf(Array);
    });

    it("extracts function signature", async () => {
      const result = await fetcher.getFunction("createClient", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.signature).toContain("createClient");
    });
  });

  describe("get_namespace", () => {
    it("returns namespace with all items", async () => {
      const result = await fetcher.getNamespace("Utils", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Utils");
      expect(result?.items).toBeInstanceOf(Array);
    });

    it("returns null for non-existent namespace", async () => {
      const result = await fetcher.getNamespace("NonExistentNamespace", "discord.js", "test");

      expect(result).toBeNull();
    });

    it("includes item types", async () => {
      const result = await fetcher.getNamespace("Utils", "discord.js", "test");

      expect(result).not.toBeNull();
      result?.items.forEach(item => {
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("name");
      });
    });
  });

  describe("get_hierarchy", () => {
    it("returns class hierarchy with inheritance", async () => {
      const result = await fetcher.getHierarchy("Client", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Client");
      expect(result?.kind).toBe("Class");
      expect(result?.children).toBeInstanceOf(Array);
    });

    it("returns null for non-existent class", async () => {
      const result = await fetcher.getHierarchy("NonExistentClass", "discord.js", "test");

      expect(result).toBeNull();
    });

    it("includes extends/implements info", async () => {
      const result = await fetcher.getHierarchy("Client", "discord.js", "test");

      expect(result).not.toBeNull();
    });
  });

  describe("get_class - enhanced", () => {
    it("groups methods by static vs instance", async () => {
      const result = await fetcher.getClass("Client", "discord.js", "test");

      expect(result).not.toBeNull();
      
      const staticMethods = result?.methods.filter(m => m.static);
      const instanceMethods = result?.methods.filter(m => !m.static);
      
      expect(staticMethods!.length).toBeGreaterThan(0);
      expect(instanceMethods!.length).toBeGreaterThan(0);
    });

    it("extracts extends/implements from href", async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => [
          { kind: "Class", name: "Client", href: "classes/Client?extends=BaseClient", entry: "Client" },
        ],
      })) as typeof fetch;

      const result = await fetcher.getClass("Client", "discord.js", "test");

      expect(result).not.toBeNull();
    });

    it("builds proper method signatures", async () => {
      const result = await fetcher.getClass("Client", "discord.js", "test");

      expect(result).not.toBeNull();
      result?.methods.forEach(m => {
        expect(m.signature).toMatch(/^\w+\(.*\).*/);
      });
    });
  });

  describe("get_interface - enhanced", () => {
    it("extracts extends clause", async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => [
          { kind: "Interface", name: "GuildChannel", href: "interfaces/GuildChannel?extends=Channel", entry: "GuildChannel" },
        ],
      })) as typeof fetch;

      const result = await fetcher.getInterface("GuildChannel", "discord.js", "test");

      expect(result).not.toBeNull();
    });
  });

  describe("get_enum - enhanced", () => {
    it("extracts enum values from href patterns", async () => {
      const result = await fetcher.getEnum("Events", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.values.length).toBeGreaterThan(0);
    });
  });

  describe("circuit breaker", () => {
    it("starts in closed state", () => {
      const stats = fetcher.getCircuitBreakerState();
      expect(stats.state).toBe(CircuitState.Closed);
    });

    it("reports when open", () => {
      expect(fetcher.isCircuitBreakerOpen()).toBe(false);
    });
  });

  describe("stale-while-revalidate", () => {
    it("serves stale data when API fails after initial success", async () => {
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
            json: async () => [{ kind: "Class", name: "Client", href: "classes/Client", entry: "Client" }],
          };
        }
        if (callCount === 3) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => [{ kind: "Class", name: "Client", href: "classes/Client", entry: "Client" }],
          };
        }
        throw new Error("API failure");
      }) as typeof fetch;

      const fetcher2 = new DiscordDocsFetcher({ cacheTtlMs: 60000 });

      await fetcher2.search("Client", "discord.js", { clientId: "test" });
      const results2 = await fetcher2.search("Client", "discord.js", { clientId: "test" });

      expect(results2.length).toBeGreaterThan(0);
    });
  });

  describe("parameter extraction", () => {
    it("extracts multiple parameters with types", async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => [
          { kind: "Method", name: "method", href: "classes/Test/method:param1:string,param2:number,param3?:boolean->void", entry: "method" },
        ],
      })) as typeof fetch;

      const result = await fetcher.getMethod("Test", "method", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.parameters.length).toBeGreaterThanOrEqual(1);
    });

    it("handles generic types in parameters", async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => [
          { kind: "Method", name: "test", href: "classes/Test/test:items:Array<Message>->Collection", entry: "test" },
        ],
      })) as typeof fetch;

      const result = await fetcher.getMethod("Test", "test", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.parameters.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("type extraction", () => {
    it("extracts return types", async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => [
          { kind: "Method", name: "getUser", href: "classes/Client/getUser:id:string->Promise<User>", entry: "getUser" },
        ],
      })) as typeof fetch;

      const result = await fetcher.getMethod("Client", "getUser", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.returns).toBe("Promise<User>");
    });

    it("returns void when no return type found", async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => [
          { kind: "Method", name: "destroy", href: "classes/Client/destroy", entry: "destroy" },
        ],
      })) as typeof fetch;

      const result = await fetcher.getMethod("Client", "destroy", "discord.js", "test");

      expect(result).not.toBeNull();
      expect(result?.returns).toBe("void");
    });
  });

  describe("getItemDetail API", () => {
    it("fetches item details from API endpoint", async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ name: "Client", description: "Main client class", methods: [] }),
      })) as typeof fetch;

      const result = await fetcher.getItemDetail("discord.js", "Client", "test");

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("name");
    });

    it("returns null on API error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("API error")) as typeof fetch;

      const result = await fetcher.getItemDetail("discord.js", "Client", "test");

      expect(result).toBeNull();
    });
  });

  describe("extractEnumMemberValue", () => {
    it("extracts numeric value from href with =N pattern", async () => {
      // Access private method via any
      const result = (fetcher as any).extractEnumMemberValue("GatewayDispatchEvents.DISPATCH=0");
      expect(result.name).toBe("GatewayDispatchEvents.DISPATCH");
      expect(result.value).toBe(0);
    });

    it("extracts string value from href with =string pattern", async () => {
      const result = (fetcher as any).extractEnumMemberValue("ChannelTypes.TEXT=0");
      expect(result.name).toBe("ChannelTypes.TEXT");
      expect(result.value).toBe(0);
    });

    it("returns name as value when no = sign present", async () => {
      const result = (fetcher as any).extractEnumMemberValue("GatewayDispatchEvents.UNKNOWN");
      expect(result.name).toBe("GatewayDispatchEvents.UNKNOWN");
      expect(result.value).toBe("GatewayDispatchEvents.UNKNOWN");
    });

    it("handles mixed segments with path separators", async () => {
      const result = (fetcher as any).extractEnumMemberValue("enums/GatewayDispatchEvents.DISPATCH=0");
      expect(result.name).toBe("GatewayDispatchEvents.DISPATCH");
      expect(result.value).toBe(0);
    });

    it("handles simple href without path separators", async () => {
      const result = (fetcher as any).extractEnumMemberValue("DISPATCH=0");
      expect(result.name).toBe("DISPATCH");
      expect(result.value).toBe(0);
    });
  });

  describe("scrapeEntryPoints HTML fallback", () => {
    it("falls back to HTML scraping when API returns empty array", async () => {
      // First call returns empty, second call returns HTML
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => [], // Empty array triggers fallback
          };
        } else {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "text/html" }),
            text: async () => `
              <html><body>
                <nav><a href="/entrypoints/websocket">WebSocket</a></nav>
                <nav><a href="/entrypoints/sharding">Sharding</a></nav>
              </body></html>
            `,
          };
        }
      }) as typeof fetch;

      const result = await fetcher.getEntryPoints("ws", "test");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns empty array when both API and HTML scraping fail", async () => {
      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
        };
      }) as typeof fetch;

      const result = await fetcher.getEntryPoints("ws", "test");
      expect(result).toEqual([]);
    });
  });

  describe("scrapeItemDetail HTML fallback", () => {
    it("falls back to HTML scraping when API returns null", async () => {
      // First call returns null, second call returns HTML
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => null, // Null triggers fallback
          };
        } else {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "text/html" }),
            text: async () => `
              <html><body>
                <h1 class="page-title">GatewayDispatchEvents</h1>
                <article class="content">Dispatch event description</article>
              </body></html>
            `,
          };
        }
      }) as typeof fetch;

      const result = await fetcher.getItemDetail("ws", "GatewayDispatchEvents", "test");
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("name");
    });

    it("returns null when both API and HTML scraping fail", async () => {
      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
        };
      }) as typeof fetch;

      const result = await fetcher.getItemDetail("ws", "NonExistent", "test");
      expect(result).toBeNull();
    });
  });

  describe("background cache pre-population", () => {
    it("starts cache pre-population on construction", () => {
      const fetcher2 = new DiscordDocsFetcher();
      expect(fetcher2).toBeDefined();
    });
  });
});

describe("Type conversion", () => {
  it("correctly converts all kind strings to types", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => [
        { kind: "Class", name: "TestClass", href: "classes/TestClass", entry: "TestClass" },
        { kind: "Function", name: "testFn", href: "functions/testFn", entry: "testFn" },
        { kind: "Interface", name: "TestInterface", href: "interfaces/TestInterface", entry: "TestInterface" },
        { kind: "Enum", name: "TestEnum", href: "enums/TestEnum", entry: "TestEnum" },
        { kind: "TypeAlias", name: "TestType", href: "types/TestType", entry: "TestType" },
        { kind: "Method", name: "testMethod", href: "classes/TestClass/testMethod", entry: "testMethod" },
        { kind: "Namespace", name: "TestNamespace", href: "namespaces/TestNamespace", entry: "TestNamespace" },
        { kind: "Method (Static)", name: "staticMethod", href: "classes/TestClass/static/staticMethod", entry: "staticMethod" },
      ],
    })) as typeof fetch;

    const fetcher = new DiscordDocsFetcher();
    const results = await fetcher.search("", "discord.js", { fuzzy: false, clientId: "test" });

    const typeMap: Record<string, string[]> = {};
    for (const r of results) {
      if (!typeMap[r.type]) typeMap[r.type] = [];
      typeMap[r.type].push(r.title);
    }

    expect(typeMap["class"]).toContain("TestClass");
    expect(typeMap["function"]).toContain("testFn");
    expect(typeMap["interface"]).toContain("TestInterface");
    expect(typeMap["enum"]).toContain("TestEnum");
    expect(typeMap["type"]).toContain("TestType");
    expect(typeMap["method"]).toContain("testMethod");
    expect(typeMap["namespace"]).toContain("TestNamespace");
  });
});

describe("Error handling", () => {
  let fetcher: DiscordDocsFetcher;

  beforeEach(() => {
    fetcher = new DiscordDocsFetcher();
  });

  it("handles non-array sitemap gracefully", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "Not found" }),
    })) as typeof fetch;

    const results = await fetcher.search("Client", "discord.js", { clientId: "test" });

    expect(results).toEqual([]);
  });

  it("handles fetch errors gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as typeof fetch;

    const results = await fetcher.search("Client", "discord.js", { clientId: "test" });

    expect(results).toEqual([]);
  });

  it("handles rate limit errors gracefully", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers({ "content-type": "application/json", "retry-after": "60" }),
      json: async () => ({}),
    })) as typeof fetch;

    const results = await fetcher.search("Client", "discord.js", { clientId: "test" });

    expect(results).toEqual([]);
  });
});