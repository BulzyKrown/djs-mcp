/**
 * Version detector for discord.js.
 * Scrapes version from docs landing page with 24h cache.
 */

import * as cheerio from "cheerio";
import { DocCache, buildCacheKey } from "./cache.js";
import { logger } from "./logger.js";
import { globalMetrics } from "./metrics.js";

const BASE_URL = "https://discord.js.org";
const DOCS_LANDING_PATH = "/docs/packages/discord.js";

/**
 * Version detection result.
 */
export interface VersionInfo {
  version: string;
  url: string;
  detectedAt: number;
}

/**
 * Fallback version when detection fails.
 */
const FALLBACK_VERSION = "14.26.4";

/**
 * Cache duration for version info (24 hours).
 */
const VERSION_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Version detector with scraping and caching.
 */
export class VersionDetector {
  private cache: DocCache;
  private readonly fallback: string;

  constructor(fallbackVersion = FALLBACK_VERSION) {
    this.cache = new DocCache(5, VERSION_CACHE_TTL);
    this.fallback = fallbackVersion;
  }

  /**
   * Detect latest discord.js version from docs landing page.
   */
  async detectLatestVersion(): Promise<VersionInfo> {
    const cacheKey = buildCacheKey("version", "latest");

    // Check cache first
    const cached = this.cache.get<VersionInfo>(cacheKey);
    if (cached) {
      globalMetrics.recordCacheHit();
      logger.debug({}, `Version cache hit: ${cached.version}`);
      return cached;
    }

    globalMetrics.recordCacheMiss();
    logger.info({}, "Detecting latest discord.js version...");

    try {
      const response = await fetch(`${BASE_URL}${DOCS_LANDING_PATH}`, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (Version Detector)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        logger.warn({}, `Version fetch failed: ${response.status} ${response.statusText}`);
        return this.getFallback();
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Try to extract version from page content
      // Pattern 1: Look for version in URL or links
      const versionFromUrl = this.extractFromUrl($);
      if (versionFromUrl) {
        const result: VersionInfo = {
          version: versionFromUrl,
          url: `${BASE_URL}/docs/packages/discord.js/${versionFromUrl}`,
          detectedAt: Date.now(),
        };
        this.cache.set(cacheKey, result);
        logger.info({}, `Detected version: ${versionFromUrl}`);
        return result;
      }

      // Pattern 2: Look for version in page text
      const versionFromText = this.extractFromText($);
      if (versionFromText) {
        const result: VersionInfo = {
          version: versionFromText,
          url: `${BASE_URL}/docs/packages/discord.js/${versionFromText}`,
          detectedAt: Date.now(),
        };
        this.cache.set(cacheKey, result);
        logger.info({}, `Detected version from text: ${versionFromText}`);
        return result;
      }

      logger.warn({}, "Could not extract version from page");
      return this.getFallback();
    } catch (error) {
      logger.error({ err: error }, "Version detection failed");
      return this.getFallback();
    }
  }

  /**
   * Extract version from URLs in the page.
   */
  private extractFromUrl($: cheerio.CheerioAPI): string | null {
    // Look for /docs/packages/discord.js/X.Y.Z pattern
    const linkPattern = /\/docs\/packages\/discord\.js\/(\d+\.\d+\.\d+(?:-[\w.]+)?)/i;
    let version: string | null = null;

    // Check all links
    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(linkPattern);
      if (match && !version) {
        version = match[1];
      }
    });

    return version;
  }

  /**
   * Extract version from page text content.
   */
  private extractFromText($: cheerio.CheerioAPI): string | null {
    // Version pattern: major.minor.patch
    const versionPattern = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/;
    const pageText = $("body").text();

    // Find first version that looks like a discord.js version
    const match = pageText.match(versionPattern);
    return match ? match[1] : null;
  }

  /**
   * Get fallback version info.
   */
  private getFallback(): VersionInfo {
    const cacheKey = buildCacheKey("version", "latest");

    // Even fallback can be cached
    const cached = this.cache.get<VersionInfo>(cacheKey);
    if (cached) {
      return cached;
    }

    const result: VersionInfo = {
      version: this.fallback,
      url: `${BASE_URL}/docs/packages/discord.js/${this.fallback}`,
      detectedAt: Date.now(),
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Force refresh the version cache.
   */
  async refresh(): Promise<VersionInfo> {
    const cacheKey = buildCacheKey("version", "latest");
    // Bypass cache by manually triggering detection
    return this.detectLatestVersion();
  }

  /**
   * Get current cached version without detection.
   */
  getCachedVersion(): string | null {
    const cacheKey = buildCacheKey("version", "latest");
    const cached = this.cache.get<VersionInfo>(cacheKey);
    return cached?.version || null;
  }

  /**
 * Detect version for a specific package.
 * Uses package.json if available, otherwise falls back to HTML scraping.
 */
  async detectVersion(packageName: string): Promise<VersionInfo> {
    const cacheKey = buildCacheKey("version", packageName);

    // Check cache first
    const cached = this.cache.get<VersionInfo>(cacheKey);
    if (cached) {
      globalMetrics.recordCacheHit();
      logger.debug({ package: packageName }, `Version cache hit for ${packageName}: ${cached.version}`);
      return cached;
    }

    globalMetrics.recordCacheMiss();
    logger.info({ package: packageName }, `Detecting version for ${packageName}...`);

    // Try package.json first
    const versionFromPackageJson = await this.detectVersionFromPackageJson(packageName);
    if (versionFromPackageJson) {
      const result: VersionInfo = {
        version: versionFromPackageJson,
        url: `${BASE_URL}/docs/packages/${packageName}/${versionFromPackageJson}`,
        detectedAt: Date.now(),
      };
      this.cache.set(cacheKey, result);
      logger.info({ package: packageName, version: versionFromPackageJson }, `Detected ${packageName} version from package.json`);
      return result;
    }

    // Fall back to HTML scraping
    try {
      const docsPath = `/docs/packages/${packageName}`;
      const response = await fetch(`${BASE_URL}${docsPath}`, {
        headers: {
          "User-Agent": "mcp-discordjs/1.0.0 (Version Detector)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        logger.warn({ package: packageName, status: response.status }, `Version fetch failed for ${packageName}`);
        return this.getFallbackForPackage(packageName);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Try to extract version from page content
      const versionFromUrl = this.extractFromUrl($);
      if (versionFromUrl) {
        const result: VersionInfo = {
          version: versionFromUrl,
          url: `${BASE_URL}/docs/packages/${packageName}/${versionFromUrl}`,
          detectedAt: Date.now(),
        };
        this.cache.set(cacheKey, result);
        logger.info({ package: packageName, version: versionFromUrl }, `Detected ${packageName} version from HTML`);
        return result;
      }

      const versionFromText = this.extractFromText($);
      if (versionFromText) {
        const result: VersionInfo = {
          version: versionFromText,
          url: `${BASE_URL}/docs/packages/${packageName}/${versionFromText}`,
          detectedAt: Date.now(),
        };
        this.cache.set(cacheKey, result);
        logger.info({ package: packageName, version: versionFromText }, `Detected ${packageName} version from text`);
        return result;
      }

      logger.warn({ package: packageName }, "Could not extract version from page");
      return this.getFallbackForPackage(packageName);
    } catch (error) {
      logger.error({ err: error, package: packageName }, `Version detection failed for ${packageName}`);
      return this.getFallbackForPackage(packageName);
    }
  }

  /**
 * Fallback versions per package.
 */
private static readonly PACKAGE_FALLBACK_VERSIONS: Record<string, string> = {
  "discord.js": "14.26.4",
  "builders": "14.26.4",
  "collection": "14.26.4",
  "core": "2.4.0",
  "rest": "2.6.1",
  "ws": "2.0.4",
  "voice": "2.5.0",
  "structures": "14.26.4",
  "util": "14.26.4",
  "formatters": "14.26.4",
};

/**
 * Get fallback version info for a specific package.
 */
private getFallbackForPackage(packageName: string): VersionInfo {
  const cacheKey = buildCacheKey("version", packageName);

  // Even fallback can be cached
  const cached = this.cache.get<VersionInfo>(cacheKey);
  if (cached) {
    return cached;
  }

  const fallbackVersion = VersionDetector.PACKAGE_FALLBACK_VERSIONS[packageName] || this.fallback;
  const result: VersionInfo = {
    version: fallbackVersion,
    url: `${BASE_URL}/docs/packages/${packageName}/${fallbackVersion}`,
    detectedAt: Date.now(),
  };

  this.cache.set(cacheKey, result);
  return result;
}

  /**
   * Force refresh the version cache for a specific package.
   */
  async refreshPackage(packageName: string): Promise<VersionInfo> {
    return this.detectVersion(packageName);
  }

  /**
   * Get current cached version without detection for a specific package.
   */
  getCachedVersionForPackage(packageName: string): string | null {
    const cacheKey = buildCacheKey("version", packageName);
    const cached = this.cache.get<VersionInfo>(cacheKey);
    return cached?.version || null;
  }

  /**
   * Detect version from package.json in node_modules.
   * Reads the installed version of @discordjs/{packageName} from local node_modules.
   */
  async detectVersionFromPackageJson(packageName: string): Promise<string | null> {
    const cacheKey = buildCacheKey("packageJson", packageName);

    // Check cache first
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      globalMetrics.recordCacheHit();
      return cached;
    }

    globalMetrics.recordCacheMiss();

    try {
      // Try to find package.json in node_modules
      const packageJsonPath = `/node_modules/@discordjs/${packageName}/package.json`;

      // In Node.js, we can use require.resolve or read the file
      // Using dynamic import to read package.json
      const fs = await import('fs');
      const pathModule = await import('path');

      // Check common locations for node_modules
      const possiblePaths = [
        pathModule.resolve(process.cwd(), `node_modules/@discordjs/${packageName}/package.json`),
        pathModule.resolve(process.cwd(), `node_modules/discord.js/node_modules/@discordjs/${packageName}/package.json`),
        pathModule.resolve(__dirname, `../../node_modules/@discordjs/${packageName}/package.json`),
      ];

      for (const pkgPath of possiblePaths) {
        try {
          if (fs.existsSync(pkgPath)) {
            const content = fs.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(content);
            if (pkg.version) {
              this.cache.set(cacheKey, pkg.version);
              logger.debug({ package: packageName, version: pkg.version }, "Detected version from package.json");
              return pkg.version;
            }
          }
        } catch {
          // Try next path
        }
      }

      logger.warn({ package: packageName }, "Could not find package.json for version detection");
      return null;
    } catch (error) {
      logger.debug({ err: error, package: packageName }, "Version detection from package.json failed");
      return null;
    }
  }
}

/**
 * Global version detector instance.
 */
export const globalVersionDetector = new VersionDetector();