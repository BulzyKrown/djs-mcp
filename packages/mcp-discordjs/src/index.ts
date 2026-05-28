import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DiscordDocsFetcher } from "./fetcher.js";

export { DiscordDocsFetcher } from "./fetcher.js";
export type { 
  DocResult, ClassDoc, MethodDoc, EnumDoc, InterfaceDoc, DocType,
  TypeAliasDoc, FunctionDoc, NamespaceDoc, HierarchyNode,
  AutocompleteResult, SearchAllResult, ExplainTypeResult,
  SitemapItem
} from "./fetcher.js";

export { TypedError, NetworkError, ScrapingError, CacheError, RateLimitError } from "./errors.js";

export { ok, err, isSuccess, isFailure } from "./result.js";
export type { Result } from "./result.js";
export { Success, Failure } from "./result.js";

export { retry } from "./retry.js";
export type { RetryConfig } from "./retry.js";

export { CircuitBreaker, CircuitState } from "./circuit-breaker.js";
export type { CircuitBreakerConfig } from "./circuit-breaker.js";

export { ResultCache, DocCache, buildCacheKey } from "./cache.js";
export type { CacheConfig, CacheStats } from "./cache.js";

export { logger, createLogger, StructuredLogger } from "./logger.js";
export type { LogLevel, LogContext } from "./logger.js";

export { globalMetrics, MetricsCollector } from "./metrics.js";
export type { MetricsSnapshot, LatencyStats } from "./metrics.js";

export { RequestTracer, createTrace, createTraceFrom } from "./tracer.js";
export type { TraceMark, TraceContext } from "./tracer.js";

export { SelectorChain, DISCORD_DOCS_SELECTORS, getSelectorChain, extractWithChain } from "./selectors.js";
export type { SelectorConfig, SelectorResult } from "./selectors.js";

export { PatternExtractor, defaultExtractor, COMMON_PATTERNS } from "./patterns.js";
export type { PatternMatch } from "./patterns.js";

export { validate, withValidation, schemas } from "./validation.js";
export type { ValidationResult } from "./validation.js";

export { RateLimiter, globalRateLimiter } from "./rate-limiter.js";
export type { RateLimitConfig, RateLimitInfo } from "./rate-limiter.js";

export { VersionDetector, globalVersionDetector } from "./version-detector.js";
export type { VersionInfo } from "./version-detector.js";

export {
  paginate,
  parsePagination,
  encodeCursor,
  decodeCursor,
  createPaginatedResponse,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "./pagination.js";
export type { PaginationParams, PaginatedResult, Cursor } from "./pagination.js";

import { globalRateLimiter } from "./rate-limiter.js";
import { globalVersionDetector } from "./version-detector.js";
import { schemas, withValidation } from "./validation.js";
import { parsePagination, createPaginatedResponse } from "./pagination.js";
import { retry } from "./retry.js";
import { logger } from "./logger.js";
import type { DocType } from "./fetcher.js";

const server = new McpServer({
  name: "discord.js-docs",
  version: "1.3.0",
});

const fetcher = new DiscordDocsFetcher();

function getClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function withRetryAndLimit<T>(
  operation: () => Promise<T>,
  clientId: string
): Promise<T> {
  return globalRateLimiter.withLimit(clientId, async () => {
    return retry(operation, { attempts: 3, baseDelay: 200 }).then((result) => {
      if (result.ok) {
        return result.value;
      }
      throw result.error;
    });
  });
}

const DOC_TYPES = ["class", "method", "type", "function", "package", "interface", "enum", "namespace"] as const;
const PACKAGES = ["discord.js", "builders", "collection", "core", "rest", "voice", "ws", "structures", "util", "formatters", "brokers", "proxy"] as const;

fetcher.startCachePrePopulation();

server.registerTool(
  "search_docs",
  {
    description: "Search discord.js documentation with Levenshtein typo tolerance (edit distance <= 2), fuzzy matching, and type filtering",
    inputSchema: {
      query: z.string().describe("Search query for discord.js documentation"),
      package: z.enum(PACKAGES).optional().describe("Specific package to search within"),
      type: z.enum(DOC_TYPES).optional().describe("Filter by type: class, method, type, function, interface, enum, namespace"),
      fuzzy: z.boolean().optional().default(true).describe("Enable fuzzy matching for better results"),
      typoTolerance: z.boolean().optional().default(true).describe("Enable Levenshtein typo tolerance with edit distance <= 2"),
      offset: z.number().optional().default(0).describe("Pagination offset"),
      limit: z.number().optional().default(20).describe("Results per page (max 100)"),
    },
  },
  async ({ query, package: packageName, type, fuzzy, typoTolerance, offset, limit }) => {
    const clientId = getClientId();

    try {
      const pagination = parsePagination({ offset, limit: Math.min(limit || 20, 100) });

      const results = await withRetryAndLimit(
        () => fetcher.search(query, packageName, {
          type: type as DocType | undefined,
          fuzzy: fuzzy ?? true,
          typoTolerance: typoTolerance ?? true,
          limit: pagination.limit,
          offset: pagination.offset,
          clientId,
        }),
        clientId
      );

      const paginated = createPaginatedResponse(
        results,
        pagination,
        `search_docs:${query}`
      );

      return {
        content: [{ type: "text", text: JSON.stringify(paginated, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Search error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "search_all",
  {
    description: "Search across ALL discord.js packages simultaneously with package labels, returns results grouped by package",
    inputSchema: {
      query: z.string().describe("Search query for discord.js documentation"),
      type: z.enum(DOC_TYPES).optional().describe("Filter by type across all packages"),
      limit: z.number().optional().default(10).describe("Results per package (max 20)"),
    },
  },
  async ({ query, type, limit }) => {
    const clientId = getClientId();

    try {
      const results = await withRetryAndLimit(
        () => fetcher.searchAll(query, {
          type: type as DocType | undefined,
          limit: Math.min(limit || 10, 20),
          clientId,
        }),
        clientId
      );

      const totalResults = results.reduce((acc, pkg) => acc + pkg.total, 0);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            query,
            packages: results,
            totalPackages: results.length,
            totalResults,
            circuitBreakerOpen: fetcher.isCircuitBreakerOpen(),
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error({ err: error }, "Search all error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "autocomplete",
  {
    description: "Fast prefix-based autocomplete for IDE integration - lightweight, returns matches quickly",
    inputSchema: {
      prefix: z.string().describe("Prefix to match for autocomplete"),
      package: z.enum(PACKAGES).optional().default("discord.js").describe("Package to search in"),
      limit: z.number().optional().default(20).describe("Max results to return"),
    },
  },
  async ({ prefix, package: packageName, limit }) => {
    const clientId = getClientId();

    try {
      const result = await fetcher.autocomplete(prefix, packageName, {
        limit: Math.min(limit || 20, 50),
        clientId,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Autocomplete error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_related",
  {
    description: "Find related classes and interfaces based on naming patterns (prefix/suffix matches, camelCase segments)",
    inputSchema: {
      name: z.string().describe("Name to find related items for"),
      package: z.enum(PACKAGES).optional().default("discord.js").describe("Package to search in"),
      limit: z.number().optional().default(10).describe("Max related items to return"),
    },
  },
  async ({ name, package: packageName, limit }) => {
    const clientId = getClientId();

    try {
      const results = await withRetryAndLimit(
        () => fetcher.getRelated(name, packageName, { limit, clientId }),
        clientId
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ name, related: results }, null, 2),
        }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get related error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_class",
  {
    description: "Get documentation for a specific discord.js class including methods, properties, inheritance (extends/implements), grouped by static vs instance",
    inputSchema: {
      className: z.string().describe("Class name to retrieve documentation for"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ className, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.getClass(className, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Class "${className}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get class error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_type",
  {
    description: "Get type alias documentation with resolved type - recursively resolve type aliases to their base types",
    inputSchema: {
      typeName: z.string().describe("Type alias name to retrieve"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ typeName, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.getType(typeName, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Type "${typeName}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get type error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "explain_type",
  {
    description: "Recursively resolve a type alias to its base type, returns full resolution chain to trace complex types",
    inputSchema: {
      typeName: z.string().describe("Type name to explain/resolve"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ typeName, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.explainType(typeName, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Type "${typeName}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Explain type error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_function",
  {
    description: "Get standalone function documentation with full method signature",
    inputSchema: {
      functionName: z.string().describe("Function name to retrieve"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ functionName, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.getFunction(functionName, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Function "${functionName}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get function error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_namespace",
  {
    description: "Get all items within a namespace, grouped by type (classes, functions, types, etc.)",
    inputSchema: {
      namespaceName: z.string().describe("Namespace name to retrieve"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ namespaceName, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.getNamespace(namespaceName, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Namespace "${namespaceName}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get namespace error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_hierarchy",
  {
    description: "Get full class inheritance tree - which class extends which, implements which interfaces, and all subclasses",
    inputSchema: {
      className: z.string().describe("Class name to get hierarchy for"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ className, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.getHierarchy(className, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Class "${className}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get hierarchy error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_interface",
  {
    description: "Get documentation for a specific discord.js interface including properties, methods, and extends clauses",
    inputSchema: {
      interfaceName: z.string().describe("Interface name to retrieve documentation for"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ interfaceName, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.getInterface(interfaceName, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Interface "${interfaceName}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get interface error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_enum",
  {
    description: "Get documentation for a specific discord.js enum including all values with resolved enum values",
    inputSchema: {
      enumName: z.string().describe("Enum name to retrieve documentation for"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ enumName, package: packageName }) => {
    const clientId = getClientId();

    try {
      const result = await withRetryAndLimit(
        () => fetcher.getEnum(enumName, packageName, clientId),
        clientId
      );

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Enum "${enumName}" not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get enum error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_method",
  {
    description: "Get documentation for a specific method in a class, or list all methods in a class (static and instance)",
    inputSchema: {
      className: z.string().describe("Class name"),
      methodName: z.string().optional().describe("Method name to find (if not provided, lists all methods in class)"),
      package: z.enum(PACKAGES).optional().describe("Package to search in (defaults to discord.js)"),
    },
  },
  async ({ className, methodName, package: packageName }) => {
    const clientId = getClientId();

    try {
      if (methodName) {
        const result = await withRetryAndLimit(
          () => fetcher.getMethod(className, methodName, packageName, clientId),
          clientId
        );

        if (!result) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Method "${methodName}" not found in class "${className}"` }, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } else {
        const results = await withRetryAndLimit(
          () => fetcher.searchMethods(className, packageName, clientId),
          clientId
        );

        return {
          content: [{ type: "text", text: JSON.stringify({ className, methods: results }, null, 2) }],
        };
      }
    } catch (error) {
      logger.error({ err: error }, "Get method error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_packages",
  {
    description: "List all available discord.js packages with their latest versions",
    inputSchema: {},
  },
  async () => {
    const clientId = getClientId();

    try {
      const versionInfo = await globalVersionDetector.detectLatestVersion();

      const packages = await withRetryAndLimit(
        () => fetcher.listPackages(),
        clientId
      );

      const packagesWithVersions = await Promise.all(
        packages.map(async (pkg) => {
          if (pkg.package && pkg.package !== "discord.js") {
            try {
              const versions = await fetcher.getVersions(pkg.package, clientId);
              return {
                ...pkg,
                versions: versions.slice(0, 5),
                latestVersion: versions[0],
              };
            } catch {
              return { ...pkg, versions: [], latestVersion: null };
            }
          }
          return {
            ...pkg,
            versions: [versionInfo.version],
            latestVersion: versionInfo.version,
          };
        })
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                packages: packagesWithVersions,
                defaultVersion: versionInfo.version,
                defaultVersionUrl: versionInfo.url,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error({ err: error }, "List packages error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_version",
  {
    description: "Get the latest discord.js version",
    inputSchema: {},
  },
  async () => {
    try {
      const versionInfo = await globalVersionDetector.detectLatestVersion();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                version: versionInfo.version,
                url: versionInfo.url,
                detectedAt: new Date(versionInfo.detectedAt).toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error({ err: error }, "Get version error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_versions",
  {
    description: "Get available versions for a specific package",
    inputSchema: {
      package: z.enum(PACKAGES).optional().default("discord.js").describe("Package name"),
    },
  },
  async ({ package: packageName }) => {
    const clientId = getClientId();

    try {
      const versions = await withRetryAndLimit(
        () => fetcher.getVersions(packageName || "discord.js", clientId),
        clientId
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                package: packageName || "discord.js",
                versions,
                latestVersion: versions[0] || null,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error({ err: error }, "Get versions error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

const LOW_LEVEL_PACKAGES = ["core", "rest", "ws"] as const;

server.registerTool(
  "get_entrypoints",
  {
    description: "Get entry points for a discord.js package",
    inputSchema: {
      package: z.enum(PACKAGES).optional().default("discord.js").describe("Package name"),
    },
  },
  async ({ package: packageName }) => {
    const clientId = getClientId();

    // Warn if low-level package query without explicit package parameter
    if (LOW_LEVEL_PACKAGES.includes(packageName as typeof LOW_LEVEL_PACKAGES[number])) {
      logger.warn({ package: packageName }, "Low-level package query without explicit package parameter - consider using explicit package");
    }

    try {
      const entrypoints = await withRetryAndLimit(
        () => fetcher.getEntryPoints(packageName || "discord.js", clientId),
        clientId
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                package: packageName || "discord.js",
                entrypoints,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error({ err: error }, "Get entrypoints error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_item_detail",
  {
    description: "Get detailed information for a specific item using the API detail endpoint",
    inputSchema: {
      itemName: z.string().describe("Item name to get details for"),
      package: z.enum(PACKAGES).optional().default("discord.js").describe("Package name"),
    },
  },
  async ({ itemName, package: packageName }) => {
    const clientId = getClientId();

    // Warn if low-level package query without explicit package parameter
    if (LOW_LEVEL_PACKAGES.includes(packageName as typeof LOW_LEVEL_PACKAGES[number])) {
      logger.warn({ package: packageName, item: itemName }, "Low-level package query without explicit package parameter - consider using explicit package");
    }

    try {
      const detail = await withRetryAndLimit(
        () => fetcher.getItemDetail(packageName || "discord.js", itemName, clientId),
        clientId
      );

      if (!detail) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Item "${itemName}" detail not found` }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
      };
    } catch (error) {
      logger.error({ err: error }, "Get item detail error");
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_circuit_status",
  {
    description: "Get the current state of the circuit breaker protecting the API",
    inputSchema: {},
  },
  async () => {
    const stats = fetcher.getCircuitBreakerState();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          state: stats.state,
          failures: stats.failures,
          lastFailure: stats.lastFailure ? new Date(stats.lastFailure).toISOString() : null,
          isOpen: fetcher.isCircuitBreakerOpen(),
        }, null, 2),
      }],
    };
  }
);

server.registerTool(
  "get_mcp_version",
  {
    description: "Get the MCP server version for compatibility checking. Use this to verify client and server are aligned on version",
    inputSchema: {},
  },
  async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          serverName: "discord.js-docs",
          serverVersion: "1.6.1",
          protocolVersion: "2025-12-11",
          description: "Model Context Protocol server for discord.js documentation",
        }, null, 2),
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("discord.js MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});