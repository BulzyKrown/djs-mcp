import { z } from "zod";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { DocCache, buildCacheKey, ResultCache } from "./cache.js";
import { globalVersionDetector } from "./version-detector.js";
import { logger } from "./logger.js";
import { globalRateLimiter } from "./rate-limiter.js";
import { RateLimitError, NetworkError } from "./errors.js";
import { CircuitBreaker, CircuitState } from "./circuit-breaker.js";
import { SelectorChain, DISCORD_DOCS_SELECTORS } from "./selectors.js";
import { globalCdnIndexer } from "./cdn-indexer.js";

const BASE_URL = "https://discord.js.org";
const API_BASE_URL = "https://discord.js.org/api/docs";

const SITEMAP_CACHE_TTL = 24 * 60 * 60 * 1000;
const VERSIONS_CACHE_TTL = 24 * 60 * 60 * 1000;

export type DocType = "class" | "method" | "type" | "function" | "package" | "interface" | "enum" | "namespace";

export interface SitemapItem {
  kind: string;
  name: string;
  href: string;
  entry: string;
}

export interface DocResult {
  title: string;
  description: string;
  url: string;
  type: DocType;
  package?: string;
  kind?: string;
  score?: number;
  source?: "sitemap" | "html" | "cdn";
}

export interface ClassDoc {
  name: string;
  description: string;
  properties: Array<{ name: string; type: string; description: string; static?: boolean }>;
  methods: Array<{ name: string; signature: string; description: string; returns: string; static?: boolean }>;
  extends?: string;
  implements?: string[];
  package?: string;
  kind?: string;
  url: string;
}

export interface MethodDoc {
  name: string;
  className: string;
  signature: string;
  description: string;
  parameters: Array<{ name: string; type: string; description: string; optional: boolean }>;
  returns: string;
  examples: string[];
  package?: string;
  url: string;
  static?: boolean;
}

export interface EnumDoc {
  name: string;
  description: string;
  values: Array<{ name: string; value: string | number; description: string }>;
  package?: string;
  kind?: string;
  url: string;
}

export interface InterfaceDoc {
  name: string;
  description: string;
  properties: Array<{ name: string; type: string; description: string; optional: boolean }>;
  methods: Array<{ name: string; signature: string; description: string; returns: string }>;
  extends?: string[];
  package?: string;
  kind?: string;
  url: string;
}

export interface TypeAliasDoc {
  name: string;
  description: string;
  type: string;
  package?: string;
  kind?: string;
  url: string;
  resolvedType?: string;
}

export interface FunctionDoc {
  name: string;
  description: string;
  signature: string;
  parameters: Array<{ name: string; type: string; description: string; optional: boolean }>;
  returns: string;
  package?: string;
  kind?: string;
  url: string;
}

export interface NamespaceDoc {
  name: string;
  description: string;
  items: Array<{ name: string; type: DocType; href: string }>;
  package?: string;
  kind?: string;
  url: string;
}

export interface HierarchyNode {
  name: string;
  kind: string;
  href: string;
  extends?: string;
  implements?: string[];
  children: HierarchyNode[];
}

export interface AutocompleteResult {
  items: Array<{ name: string; type: DocType; package: string }>;
  package: string;
}

export interface SearchAllResult {
  package: string;
  items: DocResult[];
  total: number;
}

export interface ExplainTypeResult {
  name: string;
  originalType: string;
  resolvedType: string;
  chain: string[];
}

function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  
  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower[i - 1] === aLower[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[bLower.length][aLower.length];
}

function kindToType(kind: string): DocType {
  switch (kind) {
    case "Class": return "class";
    case "Function": return "function";
    case "Interface": return "interface";
    case "Enum": return "enum";
    case "Namespace": return "namespace";
    case "TypeAlias": return "type";
    default: return "method";
  }
}

function fuzzyScore(query: string, target: string): number {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  if (targetLower === queryLower) return 100;
  if (targetLower.startsWith(queryLower)) return 90;
  if (targetLower.includes(queryLower)) return 80;

  let score = 0;
  let queryIdx = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      score += 10 + consecutiveBonus;
      consecutiveBonus += 5;
      queryIdx++;
    } else {
      consecutiveBonus = 0;
    }
  }

  if (queryIdx === queryLower.length) {
    return score + (20 * targetLower.length) / (1 + Math.abs(targetLower.length - queryLower.length));
  }

  return 0;
}

function typoTolerantScore(query: string, target: string, maxEditDistance = 2): { score: number; isMatch: boolean; editDistance: number } {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  
  if (targetLower === queryLower) {
    return { score: 100, isMatch: true, editDistance: 0 };
  }
  
  if (targetLower.startsWith(queryLower)) {
    return { score: 95, isMatch: true, editDistance: 0 };
  }
  
  if (targetLower.includes(queryLower)) {
    return { score: 85, isMatch: true, editDistance: 0 };
  }
  
  const editDistance = levenshteinDistance(queryLower, targetLower);
  
  if (editDistance <= maxEditDistance) {
    const baseScore = Math.max(0, 80 - (editDistance * 30));
    return { score: baseScore, isMatch: true, editDistance };
  }
  
  const fuzzy = fuzzyScore(query, target);
  return { score: fuzzy, isMatch: fuzzy > 0, editDistance };
}

export class DiscordDocsFetcher {
  private sitemapCache: DocCache;
  private versionsCache: DocCache;
  private staleCache: DocCache;
  private sitemapByPackage: Map<string, SitemapItem[]>;
  private circuitBreaker: CircuitBreaker;
  private startupCachePromise: Promise<void> | null = null;

  constructor() {
    this.sitemapCache = new DocCache(50, SITEMAP_CACHE_TTL);
    this.versionsCache = new DocCache(20, VERSIONS_CACHE_TTL);
    this.staleCache = new DocCache(50, SITEMAP_CACHE_TTL * 7);
    this.sitemapByPackage = new Map();
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000,
    });
  }

  async prePopulateCache(): Promise<void> {
    logger.info({}, "Pre-populating cache with per-package versions...");
    
    const packages = [
      "discord.js", "builders", "collection", "core", "rest", 
      "voice", "ws", "structures", "util", "formatters"
    ];
    
    const cachePromises = packages.map(async (pkg) => {
      try {
        const versionInfo = await globalVersionDetector.detectVersion(pkg);
        const version = versionInfo.version;
        const sitemap = await this.getSitemap(pkg, version, `prepopulate-${pkg}`, false);
        if (Array.isArray(sitemap)) {
          this.sitemapByPackage.set(`${pkg}:${version}`, sitemap);
          this.sitemapCache.set(`${pkg}:${version}`, sitemap);
          logger.info({ package: pkg, version, items: sitemap.length }, "Cache pre-populated");
        }
      } catch (error) {
        logger.warn({ err: error, package: pkg }, "Failed to pre-populate cache");
      }
    });
    
    await Promise.allSettled(cachePromises);
    logger.info({}, "Cache pre-population complete");
  }

  startCachePrePopulation(): void {
    if (!this.startupCachePromise) {
      this.startupCachePromise = this.prePopulateCache().catch((err) => {
        logger.error({ err }, "Cache pre-population failed");
      });
    }
  }

  private async fetchWithRateLimit<T>(url: string, clientId: string): Promise<T> {
    return globalRateLimiter.withLimit(clientId, async () => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (Model Context Protocol Server)",
          Accept: "application/json",
        },
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
        throw new RateLimitError(
          `Rate limited by discord.js.org API. Retry after ${retryMs}ms`,
          retryMs,
          { url, status: 429 }
        );
      }

      if (!response.ok) {
        throw new NetworkError(
          `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
          response.status,
          url
        );
      }

      return response.json() as Promise<T>;
    });
  }

  async listPackages(): Promise<DocResult[]> {
    const packages = [
      { name: "discord.js", description: "Main Discord.js library" },
      { name: "discord-api-types", description: "Discord API type definitions" },
      { name: "builders", description: "Utility for building Discord API payloads" },
      { name: "collection", description: "Collection utility data structure" },
      { name: "core", description: "Core Discord API wrapper" },
      { name: "rest", description: "Discord REST API module" },
      { name: "voice", description: "Discord Voice API module" },
      { name: "ws", description: "Discord WebSocket wrapper" },
      { name: "structures", description: "Discord structures wrapper" },
      { name: "util", description: "Utility functions" },
      { name: "formatters", description: "String formatting functions" },
      { name: "brokers", description: "Broker collection for discord.js" },
      { name: "proxy", description: "HTTP proxy for Discord API" },
    ];

    const results: DocResult[] = [];

    for (const pkg of packages) {
      const versions = await this.getVersionsCached(pkg.name);
      results.push({
        title: pkg.name,
        description: pkg.description,
        url: `${BASE_URL}/docs/packages/${pkg.name}`,
        type: "package",
        kind: "Package",
        package: pkg.name,
      });
    }

    return results;
  }

  private async getVersionsCached(packageName: string): Promise<string[]> {
    const cacheKey = buildCacheKey("versions", packageName);
    const cached = this.versionsCache.get<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const versions = await this.fetchWithCache<string[]>(
        `${API_BASE_URL}/versions?packageName=${packageName}`,
        "system"
      );
      this.versionsCache.set(cacheKey, versions);
      return versions;
    } catch {
      return [];
    }
  }

  async getVersions(packageName: string, clientId: string): Promise<string[]> {
    return this.getVersionsCached(packageName);
  }

  private async fetchWithCache<T>(url: string, clientId: string, forceRefresh = false): Promise<T> {
    const cached = this.staleCache.get<T>(url);
    const isStale = this.sitemapCache.has(url);

    if (cached && !forceRefresh && isStale) {
      globalRateLimiter.withLimit(clientId, async () => {
        this.refreshInBackground(url);
      }).catch(() => {});
      return cached;
    }

    if (cached && !forceRefresh) {
      return cached;
    }

    if (!this.circuitBreaker.canRequest()) {
      if (cached) {
        logger.warn({}, "Circuit breaker open, serving stale data");
        return cached;
      }
      throw new Error("Circuit breaker is open and no stale data available");
    }

    try {
      const data = await this.fetchWithRateLimit<T>(url, clientId);
      this.sitemapCache.set(url, data);
      this.staleCache.set(url, data);
      this.circuitBreaker.recordSuccess();
      return data;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      
      if (cached) {
        logger.warn({ err: error }, "API failed, serving stale data");
        return cached;
      }
      throw error;
    }
  }

  private async refreshInBackground(url: string): Promise<void> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (Model Context Protocol Server)",
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        this.sitemapCache.set(url, data);
        this.staleCache.set(url, data);
      }
    } catch {
    }
  }

  async getSitemap(packageName: string, version: string, clientId: string, forceRefresh = false): Promise<SitemapItem[]> {
    const cacheKey = `${packageName}:${version}`;
    // Check sitemapByPackage first (populated by prePopulateCache)
    const cachedFromMemory = this.sitemapByPackage.get(cacheKey);
    if (cachedFromMemory && !forceRefresh) {
      // Also populate sitemapCache so subsequent lookups are faster
      this.sitemapCache.set(cacheKey, cachedFromMemory);
      return cachedFromMemory;
    }

    // Then check sitemapCache (populated by fetchWithCache or prePopulateCache)
    const cached = this.sitemapCache.get<SitemapItem[]>(cacheKey);
    if (cached && Array.isArray(cached) && !forceRefresh) {
      return cached;
    }

    try {
      const sitemap = await this.fetchWithCache<SitemapItem[]>(
        `${API_BASE_URL}/sitemap?packageName=${packageName}&version=${version}`,
        clientId,
        forceRefresh
      );
      if (Array.isArray(sitemap)) {
        this.sitemapCache.set(cacheKey, sitemap);
        this.sitemapByPackage.set(cacheKey, sitemap);
        return sitemap;
      }
      logger.warn({ cacheKey }, "Sitemap response was not an array");
      return [];
    } catch (error) {
      logger.error({ err: error, cacheKey }, "Failed to fetch sitemap");
      // Build the exact URL that was used for fetchWithCache - must match exactly
      const staleUrl = `${API_BASE_URL}/sitemap?packageName=${packageName}&version=${version}`;
      logger.debug({ cacheKey, staleUrl }, "Looking for stale data at URL");
      // fetchWithCache stores data in staleCache under the full URL key
      const staleData = this.staleCache.get<SitemapItem[]>(staleUrl);
      logger.debug({ cacheKey, staleUrl, found: !!staleData, isArray: Array.isArray(staleData) }, "Stale cache lookup result");
      if (staleData && Array.isArray(staleData)) {
        logger.info({ cacheKey, staleUrl }, "Serving stale sitemap data from fallback");
        return staleData;
      }
      return [];
    }
  }

async search(
    query: string,
    packageName?: string,
    options?: {
      type?: DocType;
      fuzzy?: boolean;
      typoTolerance?: boolean;
      limit?: number;
      offset?: number;
      clientId?: string;
    }
  ): Promise<DocResult[]> {
    const pkg = packageName || "discord.js";

    // Explicitly fetch CDN index on first search (non-blocking)
    if (!globalCdnIndexer.isReady()) {
      globalCdnIndexer.fetchIndex().catch(() => {});
    }

    // Try CDN indexer first if ready
    if (globalCdnIndexer.isReady()) {
      try {
        const results = await globalCdnIndexer.search(query, pkg, {
          fuzzy: options?.fuzzy,
          typoTolerance: options?.typoTolerance,
          limit: options?.limit,
          offset: options?.offset,
          type: options?.type,
        });
        if (results.length > 0) {
          logger.debug({ query, pkg, source: "cdn", count: results.length }, "Search returning CDN results");
          return results;
        }
      } catch (error) {
        logger.debug({ err: error, query, pkg }, "CDN search failed, trying legacy");
      }
    }

    // Fallback to legacy sitemap/HTML approach
    return this.searchLegacy(query, packageName, options);
  }

  /**
   * Legacy search implementation using sitemap API.
   * Used as fallback when CDN is not available.
   */
  private async searchLegacy(
    query: string,
    packageName?: string,
    options?: {
      type?: DocType;
      fuzzy?: boolean;
      typoTolerance?: boolean;
      limit?: number;
      offset?: number;
      clientId?: string;
    }
  ): Promise<DocResult[]> {
    const pkg = packageName || "discord.js";
    const clientId = options?.clientId || "search";
    const latestVersion = await this.getLatestVersion(pkg, clientId);

    // Try sitemap first for all packages - it's more reliable
    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, clientId);

      if (sitemap.length > 0) {
        const queryLower = query.toLowerCase();
        const typeFilter = options?.type;
        const useFuzzy = options?.fuzzy ?? true;
        const useTypoTolerance = options?.typoTolerance ?? true;
        const limit = options?.limit ?? 20;
        const offset = options?.offset ?? 0;

        let results: DocResult[] = sitemap
          .filter(item => {
            let matchesQuery: boolean;
            let score: number;

            if (useFuzzy || useTypoTolerance) {
              const typoResult = typoTolerantScore(query, item.name, 2);
              score = typoResult.score;
              matchesQuery = typoResult.isMatch;
            } else {
              matchesQuery = item.name.toLowerCase().includes(queryLower);
              score = matchesQuery ? 100 : 0;
            }

            const matchesType = !typeFilter || kindToType(item.kind) === typeFilter;

            return matchesQuery && matchesType;
          })
          .map(item => {
            const typoResult = typoTolerantScore(query, item.name, 2);
            return {
              title: item.name,
              description: item.kind,
              url: this.buildDocUrl(pkg, latestVersion, item.href),
              type: kindToType(item.kind),
              package: pkg,
              kind: item.kind,
              score: typoResult.score,
              source: "sitemap" as const,
            };
          })
          .sort((a, b) => (b.score || 0) - (a.score || 0));

        if (!useFuzzy && !useTypoTolerance) {
          results = results.slice(0, limit);
        }

        const paginated = results.slice(offset, offset + limit);
        logger.debug({ query, pkg, source: "sitemap", count: paginated.length }, "Search returning sitemap results");
        return paginated;
      }
    } catch (error) {
      logger.debug({ err: error, query, pkg }, "Sitemap search failed, trying HTML fallback");
    }

    // Fallback to HTML scraping if sitemap is empty
    const htmlResults = await this.searchFromHTML(query, pkg, latestVersion, options);
    if (htmlResults.length > 0) {
      logger.debug({ query, pkg, source: "html", count: htmlResults.length }, "Search returning HTML results");
      return htmlResults;
    }

    return [];
  }

  /**
   * Search documentation from HTML (primary data source).
   * Scrapes the documentation page and extracts matching items.
   */
  private async searchFromHTML(
    query: string,
    packageName: string,
    version: string,
    options?: {
      type?: DocType;
      fuzzy?: boolean;
      typoTolerance?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<DocResult[]> {
    try {
      const docUrl = `${BASE_URL}/docs/packages/${packageName}/${version}`;
      const response = await fetch(docUrl, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (HTML Scraper)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        logger.debug({ status: response.status, url: docUrl }, "Failed to fetch search HTML");
        return [];
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const limit = options?.limit ?? 20;
      const offset = options?.offset ?? 0;
      const useTypoTolerance = options?.typoTolerance ?? true;

      // Find all links that could be documentation items
      const results: DocResult[] = [];

      $("a[href]").each((_i, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();

        // Only consider docs links for the specific package
        if (!href.includes("/docs/packages/") || !text) {
          return;
        }
        // Filter by package name in URL
        if (!href.includes(`/docs/packages/${packageName}/`)) {
          return;
        }

        // Calculate match score
        let score = 0;
        let isMatch = false;

        if (useTypoTolerance) {
          const typoResult = typoTolerantScore(query, text, 2);
          score = typoResult.score;
          isMatch = typoResult.isMatch;
        } else {
          isMatch = text.toLowerCase().includes(query.toLowerCase());
          score = isMatch ? 100 : 0;
        }

        if (isMatch && score > 0) {
          // Determine type from href - handle both URL patterns:
          // 1. Old format: /classes/Client/methods/login -> method
          // 2. New format: /Client:Class, /GatewayIntentBits:Enum -> derived from suffix
          let type: DocType = "class";
          if (href.includes("/methods/")) type = "method";
          else if (href.includes("/properties/")) type = "class";
          else if (href.includes("/types/") || href.includes("/type-aliases/")) type = "type";
          else if (href.includes("/interfaces/")) type = "interface";
          else if (href.includes("/enums/")) type = "enum";
          else if (href.includes("/functions/")) type = "function";
          else {
            // New format: extract type from :Kind suffix like :Class, :Enum, :Interface, :TypeAlias
            const kindMatch = href.match(/:(Class|Enum|Interface|TypeAlias|Method|Property)$/i);
            if (kindMatch) {
              const kind = kindMatch[1].toLowerCase();
              if (kind === "class") type = "class";
              else if (kind === "enum") type = "enum";
              else if (kind === "interface") type = "interface";
              else if (kind === "typealias" || kind === "method" || kind === "property") type = "type";
            }
          }

          results.push({
            title: text,
            description: type,
            url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
            type,
            package: packageName,
            score,
            source: "html",
          });
        }
      });

      // Sort by score and apply pagination
      const sorted = results
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(offset, offset + limit);

      return sorted;
    } catch (error) {
      logger.debug({ err: error, query, packageName }, "searchFromHTML failed");
      return [];
    }
  }

  async searchAll(
    query: string,
    options?: {
      type?: DocType;
      limit?: number;
      clientId?: string;
    }
  ): Promise<SearchAllResult[]> {
    const packages = [
      "discord.js", "builders", "collection", "core", "rest",
      "voice", "ws", "structures", "util", "formatters"
    ];

    const limit = options?.limit ?? 10;
    const typeFilter = options?.type;

    const searchPromises = packages.map(async (pkg) => {
      try {
        const results = await this.search(query, pkg, {
          type: typeFilter,
          limit,
          clientId: options?.clientId || `searchAll-${pkg}`,
        });
        return {
          package: pkg,
          items: results,
          total: results.length,
        };
      } catch {
        return {
          package: pkg,
          items: [],
          total: 0,
        };
      }
    });

    const results = await Promise.all(searchPromises);
    return results.filter(r => r.total > 0);
  }

  async autocomplete(
    prefix: string,
    packageName?: string,
    options?: {
      limit?: number;
      clientId?: string;
    }
  ): Promise<AutocompleteResult> {
    const pkg = packageName || "discord.js";
    const clientId = options?.clientId || "autocomplete";
    const limit = options?.limit ?? 20;
    const latestVersion = await this.getLatestVersion(pkg, clientId);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, clientId);

      if (!Array.isArray(sitemap)) {
        return { package: pkg, items: [] };
      }

      const prefixLower = prefix.toLowerCase();

      const matches = sitemap
        .filter(item => item.name.toLowerCase().startsWith(prefixLower))
        .slice(0, limit)
        .map(item => ({
          name: item.name,
          type: kindToType(item.kind),
          package: pkg,
        }));

      return { package: pkg, items: matches };
    } catch {
      return { package: pkg, items: [] };
    }
  }

  async getRelated(
    name: string,
    packageName?: string,
    options?: {
      limit?: number;
      clientId?: string;
    }
  ): Promise<DocResult[]> {
    const pkg = packageName || "discord.js";
    const clientId = options?.clientId || "getRelated";
    const limit = options?.limit ?? 10;
    const latestVersion = await this.getLatestVersion(pkg, clientId);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, clientId);

      if (!Array.isArray(sitemap)) {
        return [];
      }

      const baseName = name.replace(/[A-Z]/g, (match, offset) => 
        offset > 0 ? `_${match}` : match
      ).toLowerCase();

      const relatedPatterns = [
        new RegExp(`^${name}[A-Z]`, "i"),
        new RegExp(`^[A-Z]${name}$`, "i"),
        new RegExp(name, "i"),
      ];

      const related = sitemap
        .filter(item => {
          if (item.name.toLowerCase() === name.toLowerCase()) return false;
          return relatedPatterns.some(pattern => pattern.test(item.name));
        })
        .slice(0, limit)
        .map(item => ({
          title: item.name,
          description: item.kind,
          url: this.buildDocUrl(pkg, latestVersion, item.href),
          type: kindToType(item.kind),
          package: pkg,
          kind: item.kind,
          score: 100,
        }));

      return related;
    } catch {
      return [];
    }
  }

  private async getLatestVersion(packageName: string, clientId: string): Promise<string> {
    try {
      // Always detect fresh version for accurate per-package tracking
      // The stale-while-revalidate pattern handles caching of the actual sitemap data
      const versionInfo = await globalVersionDetector.detectVersion(packageName);
      return versionInfo.version;
    } catch {
      return "14.26.4";
    }
  }

  private buildDocUrl(packageName: string, version: string, href: string): string {
    return `${BASE_URL}/docs/packages/${packageName}/${version}/${href}`;
  }

  async getClass(className: string, packageName?: string, clientId?: string): Promise<ClassDoc | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getClass";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap) || sitemap.length === 0) {
        return null;
      }

      const classItem = sitemap.find(
        item => item.name.toLowerCase() === className.toLowerCase() && item.kind === "Class"
      );

      if (!classItem) {
        return null;
      }

      const extendsMatch = classItem.href.match(/extends[=]?([^/&]+)/i);
      const implementsMatch = classItem.href.match(/implements[=]?([^/&]+)/i);

      // Href regex patterns for precise class member matching
      // Matches hrefs like:
      // - /classes/Client/methods/login
      // - /classes/Client/static/connect:options:...
      // - classes/Client/login:token:string->Promise (method signatures with colon)
      // - classes/Client/destroy->void (destructor-style signatures)
      // - /classes/Client/properties/id
      // - /classes/Client/static/default:Client
      const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match methods: /methods/ or /static/ or method signature (colon or ->)
      const methodPattern = new RegExp(`(?:/)?classes/${escapedClassName}/(?:methods|static)/|(?:/)?classes/${escapedClassName}/[^/]+[:->]`, "i");
      // Match properties: /properties/ or /static/ or direct property signature
      const propertyPattern = new RegExp(`(?:/)?classes/${escapedClassName}/(?:properties|static)/|(?:/)?classes/${escapedClassName}/[^/]+:`, "i");

      const methods = sitemap
        .filter(item => {
          // Use href regex pattern for precise matching
          const hrefMatch = methodPattern.test(item.href);
          return hrefMatch && (item.kind === "Method" || item.kind === "Method (Static)");
        })
        .map(item => {
          const isStatic = item.kind === "Method (Static)" || item.href.includes("/static/");
          return {
            name: item.name,
            signature: this.buildMethodSignature(item.href, className),
            description: item.kind,
            returns: this.extractReturnTypeFromHref(item.href),
            static: isStatic,
          };
        });

      const properties = sitemap
        .filter(item => {
          // Use href regex pattern for precise matching
          const hrefMatch = propertyPattern.test(item.href);
          return hrefMatch && (item.kind === "Property" || item.kind === "Property (Static)");
        })
        .map(item => {
          const isStatic = item.kind === "Property (Static)" || item.href.includes("/static/");
          return {
            name: item.name,
            type: this.extractTypeFromHref(item.href),
            description: item.kind,
            static: isStatic,
          };
        });

      // HTML fallback when methods and properties are empty
      if (methods.length === 0 && properties.length === 0) {
        logger.debug({ className, pkg }, "No members found via sitemap, attempting HTML fallback");
        const htmlMembers = await this.scrapeClassMembersFromHtml(pkg, className, latestVersion, classItem.href);
        if (htmlMembers.methods.length > 0 || htmlMembers.properties.length > 0) {
          return {
            name: classItem.name,
            description: `Class from ${pkg}`,
            properties: htmlMembers.properties,
            methods: htmlMembers.methods,
            extends: extendsMatch ? extendsMatch[1] : undefined,
            implements: implementsMatch ? implementsMatch[1].split(",").map(s => s.trim()) : undefined,
            package: pkg,
            url: this.buildDocUrl(pkg, latestVersion, classItem.href),
          };
        }
      }

      return {
        name: classItem.name,
        description: `Class from ${pkg}`,
        properties,
        methods,
        extends: extendsMatch ? extendsMatch[1] : undefined,
        implements: implementsMatch ? implementsMatch[1].split(",").map(s => s.trim()) : undefined,
        package: pkg,
        kind: classItem.kind,
        url: this.buildDocUrl(pkg, latestVersion, classItem.href),
      };
    } catch (error) {
      logger.error({ err: error, className }, "getClass error");
      return null;
    }
  }

  async getType(typeName: string, packageName?: string, clientId?: string): Promise<TypeAliasDoc | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getType";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        logger.debug({ typeName, pkg }, "getType: sitemap not an array");
        return null;
      }

      const typeItem = sitemap.find(
        item => item.name.toLowerCase() === typeName.toLowerCase() && (item.kind === "TypeAlias" || item.kind === "Type")
      );

      if (!typeItem) {
        logger.debug({ typeName, pkg, sitemapSize: sitemap.length }, "getType: type not found in sitemap");
        return null;
      }

      const resolvedType = this.extractTypeFromHref(typeItem.href);

      return {
        name: typeItem.name,
        description: `Type alias from ${pkg}`,
        type: resolvedType,
        package: pkg,
        kind: typeItem.kind,
        url: this.buildDocUrl(pkg, latestVersion, typeItem.href),
        resolvedType: resolvedType,
      };
    } catch (error) {
      logger.error({ err: error, typeName }, "getType error");
      return null;
    }
  }

  async explainType(typeName: string, packageName?: string, clientId?: string): Promise<ExplainTypeResult | null> {
    const typeDoc = await this.getType(typeName, packageName, clientId);
    
    if (!typeDoc) {
      return null;
    }

    const chain: string[] = [typeDoc.name];
    let currentType = typeDoc.resolvedType;
    const visited = new Set<string>();
    visited.add(typeDoc.name);

    while (currentType && currentType !== "unknown" && currentType !== "any") {
      if (visited.has(currentType)) {
        chain.push(`${currentType} (circular reference)`);
        break;
      }
      visited.add(currentType);

      const nextTypeDoc = await this.getType(currentType, packageName, clientId);
      if (!nextTypeDoc) {
        chain.push(currentType);
        break;
      }

      chain.push(currentType);
      currentType = nextTypeDoc.resolvedType || "unknown";
    }

    return {
      name: typeDoc.name,
      originalType: typeDoc.type,
      resolvedType: currentType || typeDoc.type,
      chain,
    };
  }

  async getFunction(functionName: string, packageName?: string, clientId?: string): Promise<FunctionDoc | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getFunction";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        return null;
      }

      const functionItem = sitemap.find(
        item => item.name.toLowerCase() === functionName.toLowerCase() && item.kind === "Function"
      );

      if (!functionItem) {
        return null;
      }

      return {
        name: functionItem.name,
        description: `Function from ${pkg}`,
        signature: this.buildMethodSignature(functionItem.href, functionName),
        parameters: this.extractParametersFromHref(functionItem.href),
        returns: this.extractReturnTypeFromHref(functionItem.href),
        package: pkg,
        kind: functionItem.kind,
        url: this.buildDocUrl(pkg, latestVersion, functionItem.href),
      };
    } catch (error) {
      logger.error({ err: error, functionName }, "getFunction error");
      return null;
    }
  }

  async getNamespace(namespaceName: string, packageName?: string, clientId?: string): Promise<NamespaceDoc | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getNamespace";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        return null;
      }

      const namespaceItem = sitemap.find(
        item => item.name.toLowerCase() === namespaceName.toLowerCase() && item.kind === "Namespace"
      );

      if (!namespaceItem) {
        return null;
      }

      const items = sitemap
        .filter(item =>
          item.href.toLowerCase().includes(`/${namespaceName.toLowerCase()}/`) ||
          item.name.toLowerCase().startsWith(namespaceName.toLowerCase())
        )
        .map(item => ({
          name: item.name,
          type: kindToType(item.kind),
          href: item.href,
        }));

      return {
        name: namespaceItem.name,
        description: `Namespace from ${pkg}`,
        items,
        package: pkg,
        kind: namespaceItem.kind,
        url: this.buildDocUrl(pkg, latestVersion, namespaceItem.href),
      };
    } catch (error) {
      logger.error({ err: error, namespaceName }, "getNamespace error");
      return null;
    }
  }

  async getHierarchy(className: string, packageName?: string, clientId?: string): Promise<HierarchyNode | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getHierarchy";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        return null;
      }

      const classItem = sitemap.find(
        item => item.name.toLowerCase() === className.toLowerCase() && item.kind === "Class"
      );

      if (!classItem) {
        return null;
      }

      const extendsMatch = classItem.href.match(/extends[=]?([^/&]+)/i);
      const implementsMatch = classItem.href.match(/implements[=]?([^/&]+)/i);

      const buildNode = (item: SitemapItem): HierarchyNode => {
        const extendsM = item.href.match(/extends[=]?([^/&]+)/i);
        const implementsM = item.href.match(/implements[=]?([^/&]+)/i);

        const children = sitemap
          .filter(child =>
            child.kind === "Class" &&
            child.href.match(new RegExp(`extends[=]?${item.name}`, "i"))
          )
          .map(child => buildNode(child));

        return {
          name: item.name,
          kind: item.kind,
          href: item.href,
          extends: extendsM ? extendsM[1] : undefined,
          implements: implementsM ? implementsM[1].split(",").map(s => s.trim()) : undefined,
          children,
        };
      };

      return buildNode(classItem);
    } catch (error) {
      logger.error({ err: error, className }, "getHierarchy error");
      return null;
    }
  }

  async getInterface(interfaceName: string, packageName?: string, clientId?: string): Promise<InterfaceDoc | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getInterface";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        logger.debug({ interfaceName, pkg }, "getInterface: sitemap not an array");
        return null;
      }

      const interfaceItem = sitemap.find(
        item => item.name.toLowerCase() === interfaceName.toLowerCase() && item.kind === "Interface"
      );

      if (!interfaceItem) {
        logger.debug({ interfaceName, pkg, sitemapSize: sitemap.length }, "getInterface: interface not found in sitemap");
        return null;
      }

      const extendsMatch = interfaceItem.href.match(/extends[=]?([^/&]+)/i);

      const properties = sitemap
        .filter(item =>
          item.href.toLowerCase().includes(`/${interfaceName.toLowerCase()}/`) &&
          item.kind === "Property"
        )
        .map(item => ({
          name: item.name,
          type: this.extractTypeFromHref(item.href),
          description: item.kind,
          optional: item.href.includes("?"),
        }));

      const methods = sitemap
        .filter(item =>
          item.href.toLowerCase().includes(`/${interfaceName.toLowerCase()}/`) &&
          item.kind === "Method"
        )
        .map(item => ({
          name: item.name,
          signature: this.buildMethodSignature(item.href, interfaceName),
          description: item.kind,
          returns: this.extractReturnTypeFromHref(item.href),
        }));

      return {
        name: interfaceItem.name,
        description: `Interface from ${pkg}`,
        properties,
        methods,
        extends: extendsMatch ? extendsMatch[1].split(",").map(s => s.trim()) : undefined,
        package: pkg,
        kind: interfaceItem.kind,
        url: this.buildDocUrl(pkg, latestVersion, interfaceItem.href),
      };
    } catch (error) {
      logger.error({ err: error, interfaceName }, "getInterface error");
      return null;
    }
  }

  async getEnum(enumName: string, packageName?: string, clientId?: string): Promise<EnumDoc | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getEnum";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        return null;
      }

      const enumItem = sitemap.find(
        item => item.name.toLowerCase() === enumName.toLowerCase() && item.kind === "Enum"
      );

      if (!enumItem) {
        return null;
      }

      // HTML scraping is PRIMARY for enum member extraction
      // Use the href directly (contains :Enum suffix) for proper URL
      const enumHref = enumItem.href;
      logger.debug({ enumName, pkg, enumHref }, "Extracting enum members via HTML scraping");
      const scrapedMembers = await this.scrapeEnumMembers(pkg, enumHref, latestVersion);

      if (scrapedMembers.length > 0) {
        return {
          name: enumItem.name,
          description: `Enum from ${pkg}`,
          values: scrapedMembers,
          package: pkg,
          kind: enumItem.kind,
          url: this.buildDocUrl(pkg, latestVersion, enumItem.href),
        };
      }

      // Fallback: try sitemap-based extraction if HTML scraping returned nothing
      const enumMembers = sitemap
        .filter(item =>
          item.href.toLowerCase().includes(`/${enumName.toLowerCase()}/`) ||
          item.name.toLowerCase().startsWith(enumName.toLowerCase())
        )
        .map(item => {
          const extracted = this.extractEnumMemberValue(item.href);
          return {
            name: item.name,
            value: extracted.value,
            description: item.kind,
          };
        });

      return {
        name: enumItem.name,
        description: `Enum from ${pkg}`,
        values: enumMembers.length > 0 ? enumMembers : [{ name: enumItem.name, value: enumItem.name, description: enumItem.kind }],
        package: pkg,
        kind: enumItem.kind,
        url: this.buildDocUrl(pkg, latestVersion, enumItem.href),
      };
    } catch (error) {
      logger.error({ err: error, enumName }, "getEnum error");
      return null;
    }
  }

  async getMethod(className: string, methodName: string, packageName?: string, clientId?: string): Promise<MethodDoc | null> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "getMethod";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        return null;
      }

      const methodItem = sitemap.find(
        item =>
          item.name.toLowerCase().includes(methodName.toLowerCase()) &&
          item.kind === "Method" &&
          (item.href.toLowerCase().includes(className.toLowerCase()) || item.href.toLowerCase().includes("/methods/"))
      );

      if (!methodItem) {
        return null;
      }

      const isStatic = methodItem.kind === "Method (Static)" || methodItem.href.includes("/static/");

      return {
        name: methodItem.name,
        className,
        signature: this.buildMethodSignature(methodItem.href, className),
        description: `Method from ${pkg}`,
        parameters: this.extractParametersFromHref(methodItem.href),
        returns: this.extractReturnTypeFromHref(methodItem.href),
        examples: [],
        package: pkg,
        url: this.buildDocUrl(pkg, latestVersion, methodItem.href),
        static: isStatic,
      };
    } catch (error) {
      logger.error({ err: error, className, methodName }, "getMethod error");
      return null;
    }
  }

  private extractTypeFromHref(href: string): string {
    const typePatterns = [
      /:(\w+(?:<[^>]+>)?)/,
      /->\s*(\w+(?:<[^>]+>)?)/,
      /\.(\w+)(?:\?|\/|$)/,
      /<(\w+(?:<[^>]+>)?)>/,
    ];

    for (const pattern of typePatterns) {
      const match = href.match(pattern);
      if (match) return match[1];
    }

    return "unknown";
  }

  private extractParametersFromHref(href: string): Array<{ name: string; type: string; description: string; optional: boolean }> {
    const params: Array<{ name: string; type: string; description: string; optional: boolean }> = [];

    const paramMatch = href.match(/\(([^)]*)\)/);
    if (paramMatch) {
      const paramStr = paramMatch[1];
      if (paramStr) {
        const parts = paramStr.split(",").map(p => p.trim()).filter(p => p);
        for (const part of parts) {
          const colonIndex = part.indexOf(":");
          if (colonIndex > 0) {
            const nameWithOptional = part.substring(0, colonIndex).trim();
            const type = part.substring(colonIndex + 1).trim();
            params.push({
              name: nameWithOptional.replace(/[?*]/g, ""),
              type: type || "any",
              description: "",
              optional: part.includes("?") || part.includes("optional"),
            });
          } else {
            params.push({
              name: part.replace(/[?*]/g, ""),
              type: "any",
              description: "",
              optional: part.includes("?") || part.includes("optional"),
            });
          }
        }
      }
    } else {
      const paramSection = href.match(/\/([^/]+):([^/]+)->/);
      if (paramSection) {
        const paramStr = paramSection[1];
        const typeStr = paramSection[2];
        const parts = paramStr.split(",").map(p => p.trim()).filter(p => p);
        const types = typeStr.split(",").map(p => p.trim());
        
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const type = types[i] || types[0] || "any";
          params.push({
            name: part.replace(/[?*]/g, ""),
            type: type,
            description: "",
            optional: part.includes("?") || part.includes("optional"),
          });
        }
      } else {
        const simpleParams = href.match(/:([^:=]+)(:([^:=]+))?(?=->)|:([^:=]+)$/);
        if (simpleParams) {
          const allParams = href.split("/").pop() || "";
          const paramParts = allParams.match(/:([a-zA-Z0-9_]+):?([a-zA-Z0-9_<>,]+)?/g);
          if (paramParts) {
            for (const p of paramParts) {
              const partsInner = p.substring(1).split(":");
              if (partsInner.length >= 2) {
                params.push({
                  name: partsInner[0].replace(/[?*]/g, ""),
                  type: partsInner[1] || "any",
                  description: "",
                  optional: p.includes("?"),
                });
              }
            }
          }
        }
      }
    }

    return params;
  }

  private extractReturnTypeFromHref(href: string): string {
    const returnMatch = href.match(/->\s*(\w+(?:<[^>]+>)?)/);
    return returnMatch ? returnMatch[1] : "void";
  }

  private buildMethodSignature(href: string, contextName: string): string {
    const params = this.extractParametersFromHref(href);
    const paramStr = params.map(p => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ");
    const returnType = this.extractReturnTypeFromHref(href);
    
    let methodName = params.length > 0 ? (href.split("/").pop()?.split("(")[0] || "method") : (href.split("/").pop()?.split(":")[0] || "method");
    methodName = methodName.replace(/[^a-zA-Z0-9_]/g, "");
    
    if (!methodName || methodName.length < 1) {
      methodName = "method";
    }

    return `${methodName}(${paramStr}): ${returnType}`;
  }

  async searchMethods(className: string, packageName?: string, clientId?: string): Promise<MethodDoc[]> {
    const pkg = packageName || "discord.js";
    const cid = clientId || "searchMethods";
    const latestVersion = await this.getLatestVersion(pkg, cid);

    try {
      const sitemap = await this.getSitemap(pkg, latestVersion, cid);

      if (!Array.isArray(sitemap)) {
        return [];
      }

      const methods = sitemap
        .filter(item =>
          item.kind === "Method" &&
          (item.href.toLowerCase().includes(className.toLowerCase()) ||
           item.name.toLowerCase().startsWith(className.toLowerCase()))
        )
        .map(item => {
          const isStatic = item.kind === "Method (Static)" || item.href.includes("/static/");
          return {
            name: item.name,
            className,
            signature: this.buildMethodSignature(item.href, className),
            description: `Method from ${pkg}`,
            parameters: this.extractParametersFromHref(item.href),
            returns: this.extractReturnTypeFromHref(item.href),
            examples: [],
            package: pkg,
            url: this.buildDocUrl(pkg, latestVersion, item.href),
            static: isStatic,
          };
        });

      return methods;
    } catch (error) {
      logger.error({ err: error, className }, "searchMethods error");
      return [];
    }
  }

async getEntryPoints(packageName: string, clientId: string): Promise<string[]> {
    try {
      const latestVersion = await this.getLatestVersion(packageName, clientId);

      // First try API endpoint for entrypoints
      const entrypointsUrl = `${API_BASE_URL}/entrypoints?packageName=${packageName}&version=${latestVersion}`;
      const apiResponse = await this.fetchWithCache<Array<{ name: string; href: string }>>(
        entrypointsUrl,
        clientId
      );

      if (Array.isArray(apiResponse) && apiResponse.length > 0) {
        logger.debug({ packageName, count: apiResponse.length }, "EntryPoints from API");
        return apiResponse.map(e => e.name);
      }
    } catch (error) {
      logger.debug({ err: error, packageName }, "EntryPoints API failed, trying sitemap");
    }

    // Fallback: use sitemap to find entrypoints
    // For low-level packages (core, rest, ws), entrypoints are Classes
    // Filter by kind === 'Class' to get actual API exports, not nav links
    try {
      const latestVersion = await this.getLatestVersion(packageName, clientId);
      const sitemap = await this.getSitemap(packageName, latestVersion, clientId);

      if (Array.isArray(sitemap) && sitemap.length > 0) {
        // For low-level packages, entrypoints are Classes
        const LOW_LEVEL_PACKAGES = ["core", "rest", "ws"];
        if (LOW_LEVEL_PACKAGES.includes(packageName)) {
          const classes = sitemap.filter(item => item.kind === "Class");
          const entrypoints = classes.map(c => c.name);
          if (entrypoints.length > 0) {
            logger.debug({ packageName, count: entrypoints.length }, "EntryPoints from sitemap (classes)");
            return entrypoints;
          }
        }

        // For other packages, filter for classes and other exportable items
        const exportableKinds = ["Class", "Namespace", "Variable"];
        const exports = sitemap.filter(item => exportableKinds.includes(item.kind));
        const entrypoints = exports.map(e => e.name);
        if (entrypoints.length > 0) {
          logger.debug({ packageName, count: entrypoints.length }, "EntryPoints from sitemap");
          return [...new Set(entrypoints)].slice(0, 50);
        }
      }
    } catch (error) {
      logger.debug({ err: error, packageName }, "EntryPoints sitemap fallback failed");
    }

    // Last resort: HTML scrape (but it often returns nav links instead of API exports)
    const latestVersionFallback = await this.getLatestVersion(packageName, clientId);
    const isLowLevelPackage = ["core", "rest", "ws"].includes(packageName);
    const scraped = await this.scrapeEntryPoints(packageName, latestVersionFallback, isLowLevelPackage);
    if (scraped.length > 0) {
      logger.debug({ packageName, count: scraped.length }, "EntryPoints from HTML scrape");
      return scraped;
    }

    logger.warn({ packageName }, "No entrypoints found for package");
    return [];
  }

  async getItemDetail(packageName: string, itemName: string, clientId: string): Promise<Record<string, unknown> | null> {
    try {
      const latestVersion = await this.getLatestVersion(packageName, clientId);
      const detail = await this.fetchWithCache<Record<string, unknown> | null>(
        `${API_BASE_URL}/item?package=${packageName}&version=${latestVersion}&name=${itemName}`,
        clientId
      );

      if (detail && Object.keys(detail).length > 0) {
        return detail;
      }

      // Fallback: scrape item detail from HTML if API returns null/empty
      logger.warn({ packageName, itemName }, "Item detail API returned empty, attempting HTML scrape fallback");
      return await this.scrapeItemDetail(packageName, itemName, latestVersion);
    } catch (_err) {
      // Try HTML scraping as fallback on error
      try {
        const latestVersion = await this.getLatestVersion(packageName, clientId);
        return await this.scrapeItemDetail(packageName, itemName, latestVersion);
      } catch (scrapeError) {
        logger.debug({ err: scrapeError, packageName, itemName }, "HTML scrape fallback failed");
      }
      return null;
    }
  }

  /**
   * Scrape entrypoints from HTML documentation page.
   * Uses selector chain to extract entrypoint names from rendered page.
   */
  private async scrapeEntryPoints(packageName: string, version: string, isLowLevelPackage = false): Promise<string[]> {
    try {
      // For low-level packages, the docs page URL is the same structure
      // but we need to look for actual API exports in the sidebar
      const docUrl = `${BASE_URL}/docs/packages/${packageName}/${version}`;
      const response = await fetch(docUrl, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (HTML Scraper)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        logger.debug({ status: response.status, url: docUrl }, "Failed to fetch entrypoints HTML");
        return [];
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const entrypoints: string[] = [];

      if (isLowLevelPackage) {
        // For low-level packages (core, rest, ws), look for sidebar links
        // that point to actual API exports (classes, interfaces, etc.)
        // These are typically in a sidebar with links like /entrypoints/websocket
        $("a[href]").each((_i, el) => {
          const href = $(el).attr("href") || "";
          const text = $(el).text().trim();

          // Look for entrypoint links (format: /entrypoints/{name} or /docs/packages/{pkg}/{version}/EntryPoint)
          // These are actual API exports for low-level packages
          if (
            text &&
            !href.includes("#") &&
            (href.includes("/entrypoints/") || href.includes(`/docs/packages/${packageName}/`))
          ) {
            entrypoints.push(text);
          }
        });

        // Deduplicate and filter
        const unique = [...new Set(entrypoints)].filter(e => e.length > 2 && e.length < 50);
        if (unique.length > 0) {
          logger.debug({ packageName, count: unique.length }, "Scraped entrypoints from low-level package HTML");
          return unique;
        }
      }

      // Default behavior for other packages - use selector chain
      const entrypointsChain = new SelectorChain(DISCORD_DOCS_SELECTORS.entrypoints);
      const linkElements = entrypointsChain.findAll($);

      if (linkElements.length > 0) {
        for (const el of linkElements) {
          const text = $(el).text().trim();
          if (text) {
            entrypoints.push(text);
          }
        }
      } else {
        // Fallback: look for sidebar links with API-relevant hrefs
        $("a[href]").each((_i, el) => {
          const href = $(el).attr("href") || "";
          const text = $(el).text().trim();

          // Filter for docs links that aren't nav menus
          if (
            text &&
            href.includes("/docs/packages/") &&
            !href.includes("discord.js.org") &&
            !href.includes("/collections") &&
            !href.includes("/guides") &&
            !href.includes("/topics")
          ) {
            entrypoints.push(text);
          }
        });
      }

      logger.debug({ packageName, count: entrypoints.length }, "Scraped entrypoints from HTML");
      return [...new Set(entrypoints)].slice(0, 50); // Deduplicate and limit
    } catch (error) {
      logger.debug({ err: error, packageName }, "scrapeEntryPoints failed");
      return [];
    }
  }

  /**
   * Scrape item detail from HTML documentation page.
   * Uses selector chain to extract item details from rendered page.
   */
  private async scrapeItemDetail(packageName: string, itemName: string, version: string): Promise<Record<string, unknown> | null> {
    try {
      // Construct URL for item detail page
      const docUrl = `${BASE_URL}/docs/packages/${packageName}/${version}/${itemName}`;
      const response = await fetch(docUrl, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (HTML Scraper)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        logger.debug({ status: response.status, url: docUrl }, "Failed to fetch item detail HTML");
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const result: Record<string, unknown> = {};

      // Extract title using selector chain
      const titleChain = new SelectorChain(DISCORD_DOCS_SELECTORS.itemDetailTitle);
      const titleResult = titleChain.extract($);
      if (titleResult.success && titleResult.value) {
        result.name = titleResult.value;
      } else {
        result.name = itemName;
      }

      // Extract description using selector chain
      const descChain = new SelectorChain(DISCORD_DOCS_SELECTORS.description);
      const descResult = descChain.extract($);
      if (descResult.success && descResult.value) {
        result.description = descResult.value;
      }

      // Extract metadata using selector chain
      const metaChain = new SelectorChain(DISCORD_DOCS_SELECTORS.itemDetailMetadata);
      const metaResult = metaChain.extract($);
      if (metaResult.success && metaResult.value) {
        result.metadata = metaResult.value;
      }

      // Extract content using selector chain
      const contentChain = new SelectorChain(DISCORD_DOCS_SELECTORS.itemDetailContent);
      const contentResult = contentChain.extract($);
      if (contentResult.success && contentResult.value) {
        result.content = contentResult.value;
      }

      result.url = docUrl;
      result.package = packageName;

      logger.debug({ packageName, itemName }, "Scraped item detail from HTML");
      return Object.keys(result).length > 1 ? result : null;
    } catch (error) {
      logger.debug({ err: error, packageName, itemName }, "scrapeItemDetail failed");
      return null;
    }
  }

  /**
   * Normalize text by removing deprecated/external artifacts.
   * Examples:
   *   "deprecatedexternal. GuildBans = 4" → "GuildBans = 4"
   *   "ExternalEnum.VALUE" → "VALUE"
   */
  private normalizeMemberText(text: string): string {
    if (!text) return text;
    let normalized = text;
    // Remove "deprecatedexternal." or "external." prefix
    normalized = normalized.replace(/^(deprecated)?external\.?\s*/i, "");
    // Remove leading class names followed by dot (for external enum members like "SomeClass.VALUE")
    // Only when the text contains a dot and looks like a scoped name
    if (normalized.includes(".") && !normalized.includes("=")) {
      // If text is like "ExternalEnum.VALUE", extract just "VALUE"
      const parts = normalized.split(".");
      if (parts.length >= 2) {
        normalized = parts[parts.length - 1];
      }
    }
    return normalized.trim();
  }

  /**
   * Scrape class members (methods and properties) from HTML documentation page.
   * Used as fallback when sitemap doesn't contain member hrefs.
   */
  private async scrapeClassMembersFromHtml(
    packageName: string,
    className: string,
    version: string,
    classHref: string
  ): Promise<{ methods: Array<{ name: string; signature: string; description: string; returns: string; static?: boolean }>; properties: Array<{ name: string; type: string; description: string; static?: boolean }> }> {
    try {
      const docUrl = `${BASE_URL}/docs/packages/${packageName}/${version}/${encodeURIComponent(classHref)}`;
      const response = await fetch(docUrl, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (HTML Scraper)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        logger.debug({ status: response.status, url: docUrl }, "Failed to fetch class HTML");
        return { methods: [], properties: [] };
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const methods: Array<{ name: string; signature: string; description: string; returns: string; static?: boolean }> = [];
      const properties: Array<{ name: string; type: string; description: string; static?: boolean }> = [];

      // Actual structure: ## Properties and ## Methods sections with ### MemberName items
      // Find sections by looking for h2 elements containing "Properties" or "Methods"
      let inProperties = false;
      let inMethods = false;

      $("h2").each((_i, el) => {
        const text = $(el).text().trim();
        const id = $(el).attr("id") || "";
        if (text.includes("Properties") || id.includes("properties")) {
          inProperties = true;
          inMethods = false;
        } else if (text.includes("Methods") || id.includes("methods")) {
          inMethods = true;
          inProperties = false;
        } else {
          inProperties = false;
          inMethods = false;
        }
      });

      // Process all h3 elements that contain method/property signatures
      $("h3[id]").each((_i, el) => {
        const text = $(el).text().trim();
        if (!text) return;

        // Check context: is this under Properties or Methods section?
        // Methods have (params) signature, properties are simpler
        const hasParens = text.includes("(") && text.includes(")");
        const isStatic = text.toLowerCase().includes("static");

        // Clean up text: remove "readonly" prefix for properties, "static" suffix
        let cleanText = text
          .replace(/^readonly\s+/, "")
          .replace(/\s+static$/, "")
          .trim();

        // For class member signatures like "### requestGuildMembers(options: ...)"
        // The id attribute contains the member name
        const id = $(el).attr("id") || "";

        if (hasParens) {
          // It's a method
          const name = id || cleanText.split("(")[0].trim();
          methods.push({
            name,
            signature: cleanText,
            description: "Method from HTML fallback",
            returns: "unknown",
            static: isStatic,
          });
        } else if (inProperties || cleanText.includes(":")) {
          // It's a property (has type annotation like ": API")
          const name = id || cleanText.split(":")[0].trim();
          const typeMatch = cleanText.match(/:\s*(.+?)(?:\s*=\s*|$)/);
          const type = typeMatch ? typeMatch[1].trim() : "unknown";

          properties.push({
            name,
            type,
            description: "Property from HTML fallback",
            static: isStatic,
          });
        } else if (id) {
          // Fallback: use id as name
          properties.push({
            name: id,
            type: "unknown",
            description: "Property from HTML fallback",
            static: isStatic,
          });
        }
      });

      // If no members found with h3[id], try to parse h3 elements without id
      if (methods.length === 0 && properties.length === 0) {
        $("h3").each((_i, el) => {
          const text = $(el).text().trim();
          if (!text) return;

          const hasParens = text.includes("(") && text.includes(")");
          if (hasParens) {
            const name = text.split("(")[0].trim();
            methods.push({
              name,
              signature: text,
              description: "Method from HTML fallback",
              returns: "unknown",
              static: text.toLowerCase().includes("static"),
            });
          } else if (text.includes(":")) {
            const name = text.split(":")[0].trim();
            const typeMatch = text.match(/:\s*(.+?)(?:\s*=\s*|$)/);
            const type = typeMatch ? typeMatch[1].trim() : "unknown";
            properties.push({
              name,
              type,
              description: "Property from HTML fallback",
              static: text.toLowerCase().includes("static"),
            });
          }
        });
      }

      logger.debug({ packageName, className, methods: methods.length, properties: properties.length }, "Scraped class members from HTML");
      return { methods, properties };
    } catch (error) {
      logger.debug({ err: error, packageName, className }, "scrapeClassMembersFromHtml failed");
      return { methods: [], properties: [] };
    }
  }

  /**
   * Scrape enum members from HTML documentation page.
   * Uses the href directly (e.g., "GatewayIntentBits:Enum") for proper URL construction.
   */
  private async scrapeEnumMembers(packageName: string, enumHref: string, version: string): Promise<Array<{ name: string; value: string | number; description: string }>> {
    try {
      // enumHref is like "GatewayIntentBits:Enum" - use directly in URL path
      const docUrl = `${BASE_URL}/docs/packages/${packageName}/${version}/${enumHref}`;
      const response = await fetch(docUrl, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (HTML Scraper)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        logger.debug({ status: response.status, url: docUrl }, "Failed to fetch enum HTML");
        return [];
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const members: Array<{ name: string; value: string | number; description: string }> = [];

      // Find all h3 elements with id attribute - these are the enum member anchors
      const h3Elements = $("h3[id]");
      logger.debug({ count: h3Elements.length, enumHref }, "Found h3 elements with id");

      if (h3Elements.length > 0) {
        // New format: h3[id] with text like "external MemberName = value"
        h3Elements.each((_i, el) => {
          const id = $(el).attr("id") || "";
          const text = $(el).text().trim();

          if (text.includes("=")) {
            const parts = text.split("=");
            let name = parts[0].trim();
            let value = parts[1].trim();

            name = name.replace(/^(deprecated)?external\.?\s*/i, "").trim();

            if (/^\d+$/.test(value)) {
              members.push({
                name,
                value: parseInt(value, 10),
                description: "Enum member",
              });
            } else {
              members.push({
                name,
                value,
                description: "Enum member",
              });
            }
          } else if (id) {
            const normalizedId = id.replace(/^(deprecated)?external\.?\s*/i, "").trim();
            if (normalizedId) {
              members.push({
                name: normalizedId,
                value: normalizedId,
                description: "Enum member",
              });
            }
          }
        });
      } else {
        // Fallback: try table rows (old format)
        const tableRows = $("table tr");
        tableRows.each((_i, el) => {
          const row = $(el);
          const cells = row.find("td");
          if (cells.length >= 2) {
            const name = cells.first().text().trim();
            const value = cells.last().text().trim();
            // Skip if name is same as enumHref (the enum itself, not a member)
            if (name && name !== enumHref && !name.includes(enumHref.split(":")[0])) {
              const numValue = /^\d+$/.test(value) ? parseInt(value, 10) : value;
              members.push({
                name,
                value: numValue,
                description: "Enum member",
              });
            }
          }
        });
      }

      logger.debug({ packageName, enumHref, count: members.length }, "Scraped enum members from HTML");
      return members;
    } catch (error) {
      logger.debug({ err: error, packageName, enumHref }, "scrapeEnumMembers failed");
      return [];
    }
  }

  /**
   * Extract enum member value from href final segment.
   * Parses patterns like "GatewayDispatchEvents.DISPATCH=0" or "UNKNOWN"
   */
  private extractEnumMemberValue(href: string): { name: string; value: string | number } {
    // Get final segment of href
    const segments = href.split("/");
    const finalSegment = segments[segments.length - 1];

    // Check for NAME=VALUE pattern in final segment
    const valueMatch = finalSegment.match(/^([^=]+)=(.+)$/);
    if (valueMatch) {
      const name = valueMatch[1];
      let value: string | number = valueMatch[2];

      // Try to parse as number
      if (/^-?\d+$/.test(value)) {
        value = parseInt(value, 10);
      }

      return { name, value };
    }

    // No value pattern - use segment as name and default value
    return { name: finalSegment, value: finalSegment };
  }

  getCircuitBreakerState(): { state: CircuitState; failures: number; lastFailure: number | null } {
    return this.circuitBreaker.getStats();
  }

  isCircuitBreakerOpen(): boolean {
    return !this.circuitBreaker.canRequest();
  }
}