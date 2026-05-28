/**
 * SelectorValidator - Validate selectors against sample HTML.
 * Helps test and maintain selectors by reporting broken ones.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

export interface ValidationResult {
  selector: string;
  valid: boolean;
  matchCount: number;
  error?: string;
  elements?: string[];
}

export interface ChainValidationResult {
  field: string;
  primaryValid: boolean;
  fallbacksValidated: ValidationResult[];
  bestSelector: string;
  recommendation: string;
}

/**
 * Validate a single CSS selector against HTML.
 */
export function validateSelector(
  html: string,
  selector: string
): ValidationResult {
  try {
    const $ = cheerio.load(html);
    const elements = $(selector);
    
    return {
      selector,
      valid: true,
      matchCount: elements.length,
      elements: elements.length > 0 
        ? elements.slice(0, 3).map((_, el) => $.html(el)).get()
        : [],
    };
  } catch (error) {
    return {
      selector,
      valid: false,
      matchCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate an entire selector chain against HTML.
 */
export function testSelectorChain(
  html: string,
  chain: {
    field: string;
    primary: string;
    fallbacks?: string[];
  }
): ChainValidationResult {
  const $ = cheerio.load(html);
  const results: ValidationResult[] = [];

  // Test primary selector
  const primaryResult = validateSelector(html, chain.primary);
  results.push(primaryResult);

  // Test fallback selectors
  const fallbackResults = (chain.fallbacks || []).map((selector) =>
    validateSelector(html, selector)
  );
  results.push(...fallbackResults);

  // Determine best selector
  let bestSelector = chain.primary;
  let bestMatchCount = primaryResult.matchCount;

  for (const result of results) {
    if (result.valid && result.matchCount > bestMatchCount) {
      bestSelector = result.selector;
      bestMatchCount = result.matchCount;
    }
  }

  // Generate recommendation
  let recommendation: string;
  if (!primaryResult.valid) {
    recommendation = `PRIMARY SELECTOR INVALID: ${primaryResult.error}`;
  } else if (primaryResult.matchCount === 0) {
    if (fallbackResults.some((r) => r.matchCount > 0)) {
      recommendation = `PRIMARY has 0 matches but fallback works. Review primary selector.`;
    } else {
      recommendation = `NO SELECTORS MATCH. Website structure may have changed.`;
    }
  } else if (primaryResult.matchCount > 0 && fallbackResults.some((r) => r.matchCount > 0)) {
    recommendation = `Chain validated. Primary works but fallbacks provide redundancy.`;
  } else {
    recommendation = `OK. Primary selector works and no fallbacks needed.`;
  }

  return {
    field: chain.field,
    primaryValid: primaryResult.valid && primaryResult.matchCount > 0,
    fallbacksValidated: results.slice(1),
    bestSelector,
    recommendation,
  };
}

/**
 * Validate all selectors from DISCORD_DOCS_SELECTORS.
 */
export function validateAllSelectors(
  html: string
): Map<string, ChainValidationResult> {
  const results = new Map<string, ChainValidationResult>();
  
  // Import here to avoid circular dependency
  const { DISCORD_DOCS_SELECTORS } = require("./selectors.js");
  
  for (const [field, config] of Object.entries(DISCORD_DOCS_SELECTORS)) {
    results.set(field, testSelectorChain(html, config as { field: string; primary: string; fallbacks?: string[] }));
  }

  return results;
}

/**
 * Generate a test report for selector validation.
 */
export function generateSelectorReport(
  html: string,
  selectors: Record<string, { field: string; primary: string; fallbacks?: string[] }>
): string {
  const lines: string[] = ["# Selector Validation Report", ""];
  
  for (const [name, config] of Object.entries(selectors)) {
    const result = testSelectorChain(html, config);
    
    lines.push(`## ${config.field} (${name})`);
    lines.push(`- Primary: ${config.primary}`);
    lines.push(`- Primary valid: ${result.primaryValid}`);
    lines.push(`- Best selector: ${result.bestSelector}`);
    lines.push(`- Recommendation: ${result.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * SelectorValidator class for batch validation.
 */
export class SelectorValidator {
  private samples: Map<string, string> = new Map();

  /**
   * Add a sample HTML for validation.
   */
  addSample(name: string, html: string): void {
    this.samples.set(name, html);
  }

  /**
   * Validate a selector across all samples.
   */
  validateAcrossSamples(selector: string): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();
    
    for (const [name, html] of this.samples) {
      results.set(name, validateSelector(html, selector));
    }

    return results;
  }

  /**
   * Get summary of which selectors work across samples.
   */
  getSelectorCoverage(): Map<string, number> {
    const coverage = new Map<string, number>();
    
    // Collect all unique selectors
    const allSelectors = new Set<string>();
    // Import selectors dynamically to avoid circular deps
    try {
      const { DISCORD_DOCS_SELECTORS } = require("./selectors.js");
      for (const config of Object.values(DISCORD_DOCS_SELECTORS)) {
        allSelectors.add((config as { primary: string }).primary);
        const fallbacks = (config as { fallbacks?: string[] }).fallbacks;
        if (fallbacks) {
          fallbacks.forEach((s) => allSelectors.add(s));
        }
      }
    } catch {
      // Selectors module not available
    }

    for (const selector of allSelectors) {
      let count = 0;
      for (const html of this.samples.values()) {
        const result = validateSelector(html, selector);
        if (result.valid && result.matchCount > 0) {
          count++;
        }
      }
      coverage.set(selector, count);
    }

    return coverage;
  }
}