/**
 * Selector Chain for robust HTML element extraction.
 * Tries primary selector first, then falls back to alternatives.
 * Each field can have up to 4 selectors (1 primary + 3 fallbacks).
 */

import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { ScrapingError } from "./errors.js";

/**
 * Configuration for a single field's selector chain.
 * Primary selector is tried first; fallbacks used on failure.
 */
export interface SelectorConfig {
  /** Human-readable field name for debugging */
  field: string;
  /** Primary selector - used first */
  primary: string;
  /** Fallback selectors - tried in order if primary fails */
  fallbacks?: readonly string[];
  /** Whether empty result should be treated as failure (default: false) */
  required?: boolean;
}

/**
 * Result from a single selector extraction attempt.
 */
export interface SelectorResult {
  success: boolean;
  value: string | null;
  selector: string;
  usedFallback: boolean;
}

/**
 * SelectorChain tries primary selectors with automatic fallback.
 * Returns first successful result across all selectors.
 */
export class SelectorChain {
  private readonly field: string;
  private readonly selectors: string[];
  private readonly required: boolean;

  /**
   * @param config - Selector configuration with primary + fallbacks
   */
  constructor(config: SelectorConfig) {
    this.field = config.field;
    // Primary + up to 3 fallbacks = max 4 selectors
    const allSelectors = [config.primary, ...(config.fallbacks || [])].slice(0, 4);
    this.selectors = allSelectors;
    this.required = config.required ?? false;
  }

  /**
   * Extract text content using this selector chain.
   * Tries selectors in order, returns first successful result.
   */
  extract($: CheerioAPI): SelectorResult {
    for (let i = 0; i < this.selectors.length; i++) {
      const selector = this.selectors[i];
      try {
        const elements = $(selector);
        if (elements.length > 0) {
          const text = elements.first().text().trim();
          if (text || !this.required) {
            return {
              success: true,
              value: text || null,
              selector,
              usedFallback: i > 0,
            };
          }
          // Found element but empty and required - try next selector
          if (this.required && i < this.selectors.length - 1) {
            continue;
          }
        }
      } catch {
        // Invalid selector syntax - try next
        if (i < this.selectors.length - 1) {
          continue;
        }
      }
    }

    return {
      success: false,
      value: null,
      selector: this.selectors[this.selectors.length - 1],
      usedFallback: this.selectors.length > 1,
    };
  }

  /**
   * Extract attribute from elements using this selector chain.
   */
  extractAttribute($: CheerioAPI, attribute: string): SelectorResult {
    for (let i = 0; i < this.selectors.length; i++) {
      const selector = this.selectors[i];
      try {
        const elements = $(selector);
        if (elements.length > 0) {
          const value = elements.first().attr(attribute);
          if (value !== undefined) {
            return {
              success: true,
              value,
              selector,
              usedFallback: i > 0,
            };
          }
        }
      } catch {
        if (i < this.selectors.length - 1) {
          continue;
        }
      }
    }

    return {
      success: false,
      value: null,
      selector: this.selectors[this.selectors.length - 1],
      usedFallback: this.selectors.length > 1,
    };
  }

  /**
   * Check if any selector in the chain matches elements.
   */
  exists($: CheerioAPI): boolean {
    for (const selector of this.selectors) {
      try {
        if ($(selector).length > 0) {
          return true;
        }
      } catch {
        // Invalid selector - continue
      }
    }
    return false;
  }

  /**
   * Get count of matching elements for primary selector.
   */
  count($: CheerioAPI): number {
    try {
      return $(this.selectors[0]).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get all matching elements for primary selector.
   */
  findAll($: CheerioAPI): AnyNode[] {
    try {
      return $(this.selectors[0]).toArray();
    } catch {
      return [];
    }
  }

  /**
   * Get the field name.
   */
  getFieldName(): string {
    return this.field;
  }

  /**
   * Get all selectors in the chain.
   */
  getSelectors(): string[] {
    return [...this.selectors];
  }
}

/**
 * Extract a value from cheerio $ using selector chain.
 */
export function extractWithChain(
  $: CheerioAPI,
  config: SelectorConfig
): string | null {
  const chain = new SelectorChain(config);
  const result = chain.extract($);
  return result.value;
}

/**
 * Common Discord.js documentation selectors.
 * Primary selectors target the current discord.js.org structure.
 * Fallbacks target alternative structures for resilience.
 */
export const DISCORD_DOCS_SELECTORS = {
  // Page title
  title: {
    field: "title",
    primary: "h1.page-title, h1#main-content-title, article header h1",
    fallbacks: ["h1.title", ".doc-header h1", "h1"],
  },

  // Main description content
  description: {
    field: "description",
    primary: "article .description, article .doc-description, article p:first-of-type",
    fallbacks: [".description p:first-child", "article p", ".content p:first-child"],
  },

  // Class/property name
  propertyName: {
    field: "propertyName",
    primary: ".property-name, .prop-name, .name, td:first-child",
    fallbacks: [".member-name", ".field-name", "code.name"],
  },

  // Property type
  propertyType: {
    field: "propertyType",
    primary: ".property-type, .type, td:nth-child(2), .member-type",
    fallbacks: [".prop-type", "code.type", "span.type"],
  },

  // Property description
  propertyDescription: {
    field: "propertyDescription",
    primary: ".property-description, td:last-child, .description",
    fallbacks: [".member-description", "td:nth-child(3)", ".prop-desc"],
  },

  // Method signature
  methodSignature: {
    field: "methodSignature",
    primary: ".method-signature, .signature, code.signature, pre code",
    fallbacks: [".method code", "code.method-signature", "pre"],
  },

  // Method return type
  methodReturns: {
    field: "methodReturns",
    primary: ".method-returns, .returns, .return-type",
    fallbacks: [".return", "code.return-type", ".returns span"],
  },

  // Method parameters
  methodParams: {
    field: "methodParams",
    primary: ".params, .parameters, .method-params",
    fallbacks: [".parameters-list", "table.params", ".method-parameters"],
  },

  // Code examples
  codeExamples: {
    field: "codeExamples",
    primary: "pre code, .code-block code, .example code",
    fallbacks: ["code.example", "pre.language-js", "pre.language-typescript"],
  },

  // Navigation links
  navLinks: {
    field: "navLinks",
    primary: "ul li a, .nav-item a, nav a",
    fallbacks: [".sidebar a", ".navigation a", "[class*='link'] a"],
  },

  // Class/interface extends clause
  extends: {
    field: "extends",
    primary: ".extends, .extends-class, .extends-interface",
    fallbacks: ["code.extends", ".heritage"],
  },

  // Entrypoint list items (for HTML scraping fallback)
  entrypoints: {
    field: "entrypoints",
    primary: "ul li a, .entrypoints-list li a, nav a[data-entrypoint]",
    fallbacks: [".sidebar a", ".navigation a", "[class*='entrypoint'] a"],
  },

  // Entrypoint link items (navigation links in entrypoint page)
  entrypointLinks: {
    field: "entrypointLinks",
    primary: "a.entrypoint-link, a[href*='/entrypoints/'], .entrypoint-item a",
    fallbacks: ["nav a", ".sidebar a", "[class*='nav'] a"],
  },

  // Item detail title
  itemDetailTitle: {
    field: "itemDetailTitle",
    primary: "h1.page-title, h1#main-content-title, article header h1",
    fallbacks: ["h1.title", ".doc-header h1", "h1.item-name"],
  },

  // Item detail content block
  itemDetailContent: {
    field: "itemDetailContent",
    primary: "article .content, article .doc-content, .item-detail-content",
    fallbacks: [".description", "article", ".doc-body"],
  },

  // Item detail metadata
  itemDetailMetadata: {
    field: "itemDetailMetadata",
    primary: ".metadata, .item-metadata, .doc-meta",
    fallbacks: [".attributes", ".properties-list", "[class*='meta']"],
  },

  // Enum member items - matches ### MemberName pattern
  enumMemberTable: {
    field: "enumMemberTable",
    primary: "h3[id], h3",
    fallbacks: ["h3.anchor", ".member h3"],
  },

  // Enum member name extraction - matches text before = value
  enumMemberName: {
    field: "enumMemberName",
    primary: "h3",
    fallbacks: ["[id]", ".anchor"],
  },

  // Enum member value extraction - matches = numeric_value after name
  enumMemberValue: {
    field: "enumMemberValue",
    primary: "h3",
    fallbacks: [],
  },

  // Class member signature extraction from HTML fallback
  classMemberSignature: {
    field: "classMemberSignature",
    primary: "h3.method-title, h3[data-method], .method h3",
    fallbacks: ["h3[id*='method']", ".section-methods h3"],
  },

  // Class method item extraction
  classMethodItem: {
    field: "classMethodItem",
    primary: ".method-item, .method-list li, .methods .method",
    fallbacks: ["[class*='method'] li", ".section-methods li", "ul.methods li"],
  },

  // Class property item extraction
  classPropertyItem: {
    field: "classPropertyItem",
    primary: ".property-item, .properties li, .props .property",
    fallbacks: ["[class*='property'] li", ".section-properties li", "ul.properties li"],
  },
} as const;

/**
 * Get selector chain for a field.
 */
export function getSelectorChain(field: keyof typeof DISCORD_DOCS_SELECTORS): SelectorChain {
  const config = DISCORD_DOCS_SELECTORS[field];
  return new SelectorChain({
    field: config.field,
    primary: config.primary,
    fallbacks: [...config.fallbacks],
  });
}