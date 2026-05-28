/**
 * CDN Indexer for discord.js documentation.
 * Fetches documentation from GitHub CDN and provides in-memory search.
 */

import { logger } from "./logger.js";
import type {
  DocType,
  DocResult,
  ClassDoc,
  EnumDoc,
  InterfaceDoc,
  TypeAliasDoc,
  FunctionDoc,
  NamespaceDoc,
  MethodDoc,
  HierarchyNode,
} from "./fetcher.js";

const CDN_BASE_URL = "https://raw.githubusercontent.com/discordjs/docs/main";

const CDN_PACKAGES = [
  "discord.js",
  "rest",
  "ws",
  "builders",
  "collection",
  "voice",
];

const CDN_BASE_URL_DJS = `${CDN_BASE_URL}/discord.js`;

export interface CdnDocItem {
  id: string;
  name: string;
  description?: string;
  type: DocType;
  package?: string;
  url?: string;
  kind?: string;
  members?: CdnDocMember[];
  extends?: string;
  implements?: string[];
}

export interface CdnDocMember {
  name: string;
  description?: string;
  type?: string;
  static?: boolean;
  optional?: boolean;
  params?: Array<{ name: string; type: string; description?: string; optional?: boolean }>;
  returns?: string;
}

export interface PackageIndex {
  name: string;
  version: string;
  items: CdnDocItem[];
  byType: Map<DocType, CdnDocItem[]>;
  byName: Map<string, CdnDocItem>;
  allItems: DocResult[];
}

export interface CdnIndex {
  version: string;
  fetchedAt: number;
  packages: Map<string, PackageIndex>;
}

/**
 * Jaro-Winkler similarity algorithm for fuzzy matching.
 * Gives higher scores to matching prefixes (useful for code identifiers).
 */
function jaroWinklerSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 1.0;

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);

    for (let j = start; j < end; j++) {
      if (bMatches[j] || aLower[i] !== bLower[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (aLower[i] !== bLower[k]) transpositions++;
    k++;
  }

  const m = matches;
  const t = transpositions / 2;

  const jaro = (m / a.length + m / b.length + (m - t) / m) / 3;

  // Winkler modification: boost for common prefix
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(a.length, b.length)); i++) {
    if (aLower[i] === bLower[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

function jaroWinklerScore(query: string, target: string): number {
  const similarity = jaroWinklerSimilarity(query, target);
  return similarity * 100;
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

export interface SearchOptions {
  fuzzy?: boolean;
  typoTolerance?: boolean;
  limit?: number;
  offset?: number;
  type?: DocType;
}

export class CdnIndexer {
  private index: CdnIndex | null = null;
  private fetchPromise: Promise<void> | null = null;
  private ready = false;
  private autoFetch = true;

  constructor(options?: { autoFetch?: boolean }) {
    // Default is false - don't auto-fetch. Let the fetcher explicitly call fetchIndex().
    // This prevents test issues where real CDN calls interfere with mock setup.
    if (options?.autoFetch === true) {
      this.fetchIndex();
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  setAutoFetch(enabled: boolean): void {
    this.autoFetch = enabled;
  }

  async ensureIndex(): Promise<void> {
    if (!this.fetchPromise) {
      this.fetchIndex();
    }
    await this.fetchPromise;
  }

  async fetchIndex(): Promise<void> {
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this.doFetch();
    return this.fetchPromise;
  }

  private async doFetch(): Promise<void> {
    logger.info({}, "Fetching documentation from CDN...");

    try {
      const allItems: CdnDocItem[] = [];

      // Fetch all packages from CDN
      for (const pkg of CDN_PACKAGES) {
        try {
          const baseUrl = pkg === "discord.js" ? CDN_BASE_URL_DJS : `${CDN_BASE_URL}/${pkg}`;
          const response = await fetch(`${baseUrl}/main.json`, {
            headers: {
              "User-Agent": "mcp-discordjs/1.6.0 (CDN Indexer)",
              Accept: "application/json",
            },
          });

          if (response.ok) {
            const data = await response.json() as Record<string, unknown>;
            const items = this.extractItemsFromJson(data, pkg);
            allItems.push(...items);
            logger.debug({ package: pkg, items: items.length }, "CDN package indexed");
          } else {
            logger.debug({ package: pkg, status: response.status }, "CDN package not available");
          }
        } catch (err) {
          logger.debug({ package: pkg, err }, "Failed to fetch CDN package");
        }
      }

      this.buildIndex(allItems);
      this.ready = allItems.length > 0;

      const totalItems = this.index?.packages.get("discord.js")?.items.length ?? 0;
      logger.info({ totalItems, packages: CDN_PACKAGES.join(", "), ready: this.ready }, "CDN index build complete");
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch CDN index");
      this.ready = false;
    }
  }

  private extractItemsFromJson(data: Record<string, unknown>, packageName: string): CdnDocItem[] {
    const items: CdnDocItem[] = [];

    // Extract classes
    for (const cls of (data.classes as Array<Record<string, unknown>> || [])) {
      items.push({
        id: `${packageName}/${cls.name as string}`,
        name: cls.name as string,
        description: cls.description as string | undefined,
        type: "class",
        package: packageName,
        kind: "Class",
        members: this.extractClassMembers(cls),
      });
    }

    // Extract functions
    for (const fn of (data.functions as Array<Record<string, unknown>> || [])) {
      items.push({
        id: `${packageName}/${fn.name as string}`,
        name: fn.name as string,
        description: fn.description as string | undefined,
        type: "function",
        package: packageName,
        kind: "Function",
      });
    }

    // Extract interfaces
    for (const iface of (data.interfaces as Array<Record<string, unknown>> || [])) {
      items.push({
        id: `${packageName}/${iface.name as string}`,
        name: iface.name as string,
        description: iface.description as string | undefined,
        type: "interface",
        package: packageName,
        kind: "Interface",
        members: this.extractInterfaceMembers(iface),
      });
    }

    // Extract enums (from typedefs that are enums)
    for (const td of (data.typedefs as Array<Record<string, unknown>> || [])) {
      if (td.type === "Enum" || (td as Record<string, unknown>)._ENUM) {
        items.push({
          id: `${packageName}/${td.name as string}`,
          name: td.name as string,
          description: td.description as string | undefined,
          type: "enum",
          package: packageName,
          kind: "Enum",
          members: this.extractEnumMembers(td),
        });
      }
    }

    return items;
  }

  private extractClassMembers(cls: Record<string, unknown>): CdnDocMember[] {
    const members: CdnDocMember[] = [];
    const clsRecord = cls as Record<string, unknown>;

    if (Array.isArray(clsRecord.props)) {
      for (const prop of clsRecord.props as Array<Record<string, unknown>>) {
        members.push({
          name: prop.name as string,
          description: prop.description as string | undefined,
          type: this.extractTypeFromMeta(prop.meta as Record<string, unknown> | undefined),
          static: prop.scope === "static",
        });
      }
    }

    if (Array.isArray(clsRecord.methods)) {
      for (const method of clsRecord.methods as Array<Record<string, unknown>>) {
        const params = Array.isArray(method.params)
          ? (method.params as Array<Record<string, unknown>>).map((p: Record<string, unknown>) => ({
              name: p.name as string,
              type: this.extractTypeFromMeta(p.meta as Record<string, unknown> | undefined),
              description: p.description as string | undefined,
              optional: p.optional as boolean | undefined,
            }))
          : undefined;

        members.push({
          name: method.name as string,
          description: method.description as string | undefined,
          params,
          returns: this.extractReturnType(method.returns),
        });
      }
    }

    return members;
  }

  private extractInterfaceMembers(iface: Record<string, unknown>): CdnDocMember[] {
    const members: CdnDocMember[] = [];
    const ifaceRecord = iface as Record<string, unknown>;

    if (Array.isArray(ifaceRecord.props)) {
      for (const prop of ifaceRecord.props as Array<Record<string, unknown>>) {
        members.push({
          name: prop.name as string,
          description: prop.description as string | undefined,
          type: this.extractTypeFromMeta(prop.meta as Record<string, unknown> | undefined),
        });
      }
    }

    return members;
  }

  private extractEnumMembers(td: Record<string, unknown>): CdnDocMember[] {
    const members: CdnDocMember[] = [];
    const tdRecord = td as Record<string, unknown>;

    if (Array.isArray(tdRecord.children)) {
      for (const child of tdRecord.children as Array<Record<string, unknown>>) {
        members.push({
          name: child.name as string,
          description: child.description as string | undefined,
          type: child.type as string | undefined,
        });
      }
    } else if (Array.isArray(tdRecord.values)) {
      for (const val of tdRecord.values as Array<Record<string, unknown>>) {
        members.push({
          name: val.name as string,
          description: val.description as string | undefined,
          type: val.value as string | undefined,
        });
      }
    }

    return members;
  }

  private extractTypeFromMeta(meta?: Record<string, unknown>): string {
    if (!meta) return "unknown";
    if (Array.isArray(meta.type)) {
      return this.formatType(meta.type);
    }
    return meta.type as string || "unknown";
  }

  private extractReturnType(returns?: unknown): string {
    if (!returns) return "void";
    if (Array.isArray(returns)) {
      return this.formatType(returns);
    }
    return String(returns);
  }

  private formatType(type: unknown): string {
    if (typeof type === "string") return type;
    if (Array.isArray(type) && type.length === 1) {
      return this.formatType(type[0]);
    }
    if (Array.isArray(type)) {
      return type.map(t => this.formatType(t)).join(" | ");
    }
    if (typeof type === "object" && type !== null) {
      const obj = type as Record<string, unknown>;
      if (obj.Array) return `${this.formatType(obj.Array)}[]`;
      if (obj.Promise) return `Promise<${this.formatType(obj.Promise)}>`;
    }
    return String(type);
  }

  private buildIndex(items: CdnDocItem[]): void {
    const packages = new Map<string, PackageIndex>();

    // Group by package
    for (const item of items) {
      const pkgName = item.package || "discord.js";

      if (!packages.has(pkgName)) {
        packages.set(pkgName, {
          name: pkgName,
          version: "main",
          items: [],
          byType: new Map(),
          byName: new Map(),
          allItems: [],
        });
      }

      const pkgIndex = packages.get(pkgName)!;
      pkgIndex.items.push(item);

      // Index by type
      const type = item.type;
      if (!pkgIndex.byType.has(type)) {
        pkgIndex.byType.set(type, []);
      }
      pkgIndex.byType.get(type)!.push(item);

      // Index by name (lowercase for case-insensitive lookup)
      const nameLower = item.name.toLowerCase();
      if (!pkgIndex.byName.has(nameLower)) {
        pkgIndex.byName.set(nameLower, item);
      }

      // Add to allItems as DocResult
      const docResult: DocResult = {
        title: item.name,
        description: item.description || item.kind || type,
        url: item.url || `${CDN_BASE_URL_DJS}/${item.name}`,
        type,
        package: pkgName,
        kind: item.kind,
        source: "cdn",
      };
      pkgIndex.allItems.push(docResult);
    }

    this.index = {
      version: "main",
      fetchedAt: Date.now(),
      packages,
    };
  }

  async search(
    query: string,
    packageName: string = "discord.js",
    options: SearchOptions = {}
  ): Promise<DocResult[]> {
    // Don't auto-fetch - return empty if not ready (let caller use fallback)
    if (!this.ready || !this.index) {
      return [];
    }

    if (!this.index) {
      return [];
    }

    const pkgIndex = this.index.packages.get(packageName);
    if (!pkgIndex) {
      return [];
    }

    const {
      fuzzy = true,
      typoTolerance = true,
      limit = 20,
      offset = 0,
      type,
    } = options;

    const queryLower = query.toLowerCase();

    // Filter items
    let results = pkgIndex.allItems.filter((item) => {
      // Type filter
      if (type && item.type !== type) {
        return false;
      }

      // Query match
      if (fuzzy || typoTolerance) {
        const score = jaroWinklerScore(query, item.title);
        if (score > 0) {
          (item as DocResult & { score: number }).score = score;
          return true;
        }
        return false;
      } else {
        return item.title.toLowerCase().includes(queryLower);
      }
    });

    // Sort by score (higher first)
    results.sort((a, b) => (b.score || 0) - (a.score || 0));

    return results.slice(offset, offset + limit);
  }

  async getItem(
    type: DocType,
    name: string,
    packageName: string = "discord.js"
  ): Promise<CdnDocItem | null> {
    if (!this.ready || !this.index) {
      await this.fetchIndex();
    }

    if (!this.index) {
      return null;
    }

    const pkgIndex = this.index.packages.get(packageName);
    if (!pkgIndex) {
      return null;
    }

    return pkgIndex.byName.get(name.toLowerCase()) || null;
  }

  async autocomplete(
    prefix: string,
    packageName: string = "discord.js",
    limit: number = 20
  ): Promise<Array<{ name: string; type: DocType; package: string }>> {
    if (!this.ready || !this.index) {
      await this.fetchIndex();
    }

    if (!this.index) {
      return [];
    }

    const pkgIndex = this.index.packages.get(packageName);
    if (!pkgIndex) {
      return [];
    }

    const prefixLower = prefix.toLowerCase();

    return pkgIndex.allItems
      .filter((item) => item.title.toLowerCase().startsWith(prefixLower))
      .slice(0, limit)
      .map((item) => ({
        name: item.title,
        type: item.type,
        package: packageName,
      }));
  }

  async getClass(
    className: string,
    packageName: string = "discord.js"
  ): Promise<ClassDoc | null> {
    const item = await this.getItem("class", className, packageName);
    if (!item) return null;

    const members: MethodDoc[] = [];
    const properties: Array<{ name: string; type: string; description: string; static?: boolean }> = [];

    if (item.members) {
      for (const member of item.members) {
        if (member.params) {
          // It's a method
          const params = member.params.map((p) => ({
            name: p.name,
            type: p.type,
            description: p.description || "",
            optional: p.optional || false,
          }));
          members.push({
            name: member.name,
            className: item.name,
            signature: `${member.name}(${params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ")}): ${member.returns || "void"}`,
            description: member.description || "",
            parameters: params,
            returns: member.returns || "void",
            examples: [],
            package: packageName,
            url: item.url || "",
            static: member.static || false,
          });
        } else if (member.type) {
          // It's a property
          properties.push({
            name: member.name,
            type: member.type,
            description: member.description || "",
            static: member.static || false,
          });
        }
      }
    }

    return {
      name: item.name,
      description: item.description || "",
      properties,
      methods: members,
      extends: item.extends,
      implements: item.implements,
      package: packageName,
      kind: item.kind,
      url: item.url || "",
    };
  }

  async getEnum(
    enumName: string,
    packageName: string = "discord.js"
  ): Promise<EnumDoc | null> {
    const item = await this.getItem("enum", enumName, packageName);
    if (!item) return null;

    const values = (item.members || []).map((m) => ({
      name: m.name,
      value: (m as { value?: string | number }).value ?? m.name,
      description: m.description || "",
    }));

    return {
      name: item.name,
      description: item.description || "",
      values,
      package: packageName,
      kind: item.kind,
      url: item.url || "",
    };
  }

  async getInterface(
    interfaceName: string,
    packageName: string = "discord.js"
  ): Promise<InterfaceDoc | null> {
    const item = await this.getItem("interface", interfaceName, packageName);
    if (!item) return null;

    const properties: Array<{ name: string; type: string; description: string; optional: boolean }> = [];
    const methods: Array<{ name: string; signature: string; description: string; returns: string }> = [];

    if (item.members) {
      for (const member of item.members) {
        if (member.params) {
          const params = member.params.map((p) => ({
            name: p.name,
            type: p.type,
            description: p.description || "",
            optional: p.optional || false,
          }));
          methods.push({
            name: member.name,
            signature: `${member.name}(${params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ")}): ${member.returns || "void"}`,
            description: member.description || "",
            returns: member.returns || "void",
          });
        } else {
          properties.push({
            name: member.name,
            type: member.type || "unknown",
            description: member.description || "",
            optional: member.optional || false,
          });
        }
      }
    }

    return {
      name: item.name,
      description: item.description || "",
      properties,
      methods,
      extends: item.extends ? [item.extends] : undefined,
      package: packageName,
      kind: item.kind,
      url: item.url || "",
    };
  }

  async getType(
    typeName: string,
    packageName: string = "discord.js"
  ): Promise<TypeAliasDoc | null> {
    const item = await this.getItem("type", typeName, packageName);
    if (!item) return null;

    return {
      name: item.name,
      description: item.description || "",
      type: item.members?.[0]?.type || "unknown",
      package: packageName,
      kind: item.kind,
      url: item.url || "",
      resolvedType: item.members?.[0]?.type || "unknown",
    };
  }

  async getFunction(
    functionName: string,
    packageName: string = "discord.js"
  ): Promise<FunctionDoc | null> {
    const item = await this.getItem("function", functionName, packageName);
    if (!item) return null;

    const params = (item.members?.[0]?.params || []).map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description || "",
      optional: p.optional || false,
    }));

    return {
      name: item.name,
      description: item.description || "",
      signature: `${item.name}(${params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ")}): ${item.members?.[0]?.returns || "void"}`,
      parameters: params,
      returns: item.members?.[0]?.returns || "void",
      package: packageName,
      kind: item.kind,
      url: item.url || "",
    };
  }

  async getNamespace(
    namespaceName: string,
    packageName: string = "discord.js"
  ): Promise<NamespaceDoc | null> {
    const item = await this.getItem("namespace", namespaceName, packageName);
    if (!item) return null;

    const items = (item.members || []).map((m) => ({
      name: m.name,
      type: kindToType(m.description || "method"),
      href: "",
    }));

    return {
      name: item.name,
      description: item.description || "",
      items,
      package: packageName,
      kind: item.kind,
      url: item.url || "",
    };
  }

  async getMethod(
    className: string,
    methodName: string,
    packageName: string = "discord.js"
  ): Promise<MethodDoc | null> {
    const classItem = await this.getItem("class", className, packageName);
    if (!classItem) return null;

    const member = classItem.members?.find(
      (m) => m.name.toLowerCase() === methodName.toLowerCase()
    );
    if (!member || !member.params) return null;

    const params = member.params.map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description || "",
      optional: p.optional || false,
    }));

    return {
      name: member.name,
      className,
      signature: `${member.name}(${params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ")}): ${member.returns || "void"}`,
      description: member.description || "",
      parameters: params,
      returns: member.returns || "void",
      examples: [],
      package: packageName,
      url: classItem.url || "",
      static: member.static || false,
    };
  }

  async searchMethods(
    className: string,
    packageName: string = "discord.js"
  ): Promise<MethodDoc[]> {
    const classItem = await this.getItem("class", className, packageName);
    if (!classItem) return [];

    const methods: MethodDoc[] = [];

    for (const member of classItem.members || []) {
      if (member.params) {
        const params = member.params.map((p) => ({
          name: p.name,
          type: p.type,
          description: p.description || "",
          optional: p.optional || false,
        }));
        methods.push({
          name: member.name,
          className,
          signature: `${member.name}(${params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ")}): ${member.returns || "void"}`,
          description: member.description || "",
          parameters: params,
          returns: member.returns || "void",
          examples: [],
          package: packageName,
          url: classItem.url || "",
          static: member.static || false,
        });
      }
    }

    return methods;
  }

  async getRelated(
    name: string,
    packageName: string = "discord.js",
    limit: number = 10
  ): Promise<DocResult[]> {
    if (!this.ready || !this.index) {
      await this.fetchIndex();
    }

    if (!this.index) {
      return [];
    }

    const pkgIndex = this.index.packages.get(packageName);
    if (!pkgIndex) {
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

    return pkgIndex.allItems
      .filter((item) => {
        if (item.title.toLowerCase() === name.toLowerCase()) return false;
        return relatedPatterns.some((pattern) => pattern.test(item.title));
      })
      .slice(0, limit);
  }
}

export const globalCdnIndexer = new CdnIndexer({ autoFetch: false });