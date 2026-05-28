/**
 * PatternExtractor - Regex-based extraction from text content.
 * Useful for extracting types, descriptions, and code patterns.
 */

export interface PatternMatch {
  fullMatch: string;
  groups: string[];
  index: number;
}

/**
 * Common pattern definitions for discord.js documentation.
 */
export const COMMON_PATTERNS = {
  // Type annotation patterns
  typeAnnotation: /\b([A-Z][a-zA-Z0-9]*)\b/,
  
  // Parameter list: (param1: type1, param2: type2)
  parameterList: /\(([^)]*)\)/,
  
  // Return type: : ReturnType
  returnType: /:\s*([A-Za-z<>[\]_|]+(?:\s*<[^>]+>)?)/,
  
  // Optional parameter: param?
  optionalParam: /(\w+)\?/,
  
  // Generic type: Type<T>
  genericType: /([A-Za-z_][A-Za-z0-9_]*)<([^>]+)>/,
  
  // Array type: type[]
  arrayType: /([A-Za-z_][A-Za-z0-9_]*)\[\]/,
  
  // Union type: type1 | type2
  unionType: /([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*([A-Za-z_][A-Za-z0-9_]*)/,
  
  // Property signature: name: type
  propertySignature: /([a-z_][a-zA-Z0-9_]*)\s*:\s*([^,;]+)/,
  
  // Method signature: name(params): returnType
  methodSignature: /([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*:\s*([^;{]+)/,
  
  // Example code block markers
  codeBlockStart: /```(?:js|javascript|ts|typescript)?/,
  codeBlockEnd: /```/,
  
  // JSDoc style comments
  jsdocParam: /@param\s+{([^}]+)}\s+(\w+)/,
  jsdocReturns: /@returns?\s+{([^}]+)}/,
  jsdocSee: /@see\s+([^\n]+)/,
  
  // Discord.js link pattern
  discordLink: /\[([^\]]+)\]\(([^)]+)\)/,
  
  // Version number pattern
  version: /(\d+\.\d+\.\d+(?:-[\w.]+)?)/,
  
  // Class name (PascalCase)
  className: /\b([A-Z][a-zA-Z0-9]*)\b/,
  
  // Function/method name (camelCase)
  functionName: /\b([a-z][a-zA-Z0-9]*)\s*\(/,
} as const;

/**
 * PatternExtractor for regex-based content extraction.
 */
export class PatternExtractor {
  private patterns: Map<string, RegExp>;

  constructor(customPatterns?: Record<string, RegExp>) {
    this.patterns = new Map(Object.entries(COMMON_PATTERNS));
    if (customPatterns) {
      for (const [key, pattern] of Object.entries(customPatterns)) {
        this.patterns.set(key, pattern);
      }
    }
  }

  /**
   * Register a new pattern.
   */
  register(name: string, pattern: RegExp): void {
    this.patterns.set(name, pattern);
  }

  /**
   * Extract first match of a pattern in text.
   */
  extract(text: string, patternName: string): string | null {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      throw new Error(`Unknown pattern: ${patternName}`);
    }
    const match = text.match(pattern);
    return match ? match[0] : null;
  }

  /**
   * Extract all matches of a pattern in text.
   */
  extractAll(text: string, patternName: string): string[] {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      throw new Error(`Unknown pattern: ${patternName}`);
    }
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      matches.push(match[0]);
      // Prevent infinite loop for zero-length matches
      if (match.index === pattern.lastIndex) {
        pattern.lastIndex++;
      }
    }
    return matches;
  }

  /**
   * Extract with named capture groups.
   */
  extractGroups(text: string, patternName: string): PatternMatch | null {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      throw new Error(`Unknown pattern: ${patternName}`);
    }
    const match = pattern.exec(text);
    if (!match) {
      return null;
    }
    return {
      fullMatch: match[0],
      groups: match.slice(1),
      index: match.index,
    };
  }

  /**
   * Extract parameter information from method signature.
   */
  extractParams(signature: string): Array<{ name: string; type: string; optional: boolean }> {
    const params: Array<{ name: string; type: string; optional: boolean }> = [];
    
    // Match parameter list
    const paramListMatch = signature.match(/\(([^)]*)\)/);
    if (!paramListMatch) {
      return params;
    }

    const paramStr = paramListMatch[1];
    if (!paramStr.trim()) {
      return params;
    }

    // Split by comma, handling generic types
    const parts = this.splitParams(paramStr);
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Parse: name?: type or name: type
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) {
        params.push({ name: trimmed, type: "unknown", optional: false });
        continue;
      }

      const name = trimmed.slice(0, colonIdx).trim();
      const typeStr = trimmed.slice(colonIdx + 1).trim();
      const optional = name.endsWith("?");
      const cleanName = optional ? name.slice(0, -1) : name;

      params.push({
        name: cleanName,
        type: typeStr,
        optional,
      });
    }

    return params;
  }

  /**
   * Extract return type from method signature.
   */
  extractReturnType(signature: string): string | null {
    // Look for : ReturnType pattern
    const match = signature.match(/:\s*([^;{]+?)(?:\s*\{|\s*$)/);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract type from type annotation.
   */
  extractType(text: string): string | null {
    // Remove leading/trailing punctuation
    const cleaned = text.replace(/^[?*]+/, "").replace(/[,;.]$/, "");
    
    // Check for generic type
    const genericMatch = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*)<([^>]+)>$/);
    if (genericMatch) {
      return `${genericMatch[1]}<${genericMatch[2]}>`;
    }

    // Check for array type
    const arrayMatch = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*)\[\]$/);
    if (arrayMatch) {
      return `${arrayMatch[1]}[]`;
    }

    // Simple type
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
      return cleaned;
    }

    return cleaned || null;
  }

  /**
   * Split parameters handling nested brackets.
   */
  private splitParams(str: string): string[] {
    const result: string[] = [];
    let current = "";
    let depth = 0;

    for (const char of str) {
      if (char === "<") depth++;
      else if (char === ">") depth--;
      else if (char === "," && depth === 0) {
        result.push(current);
        current = "";
        continue;
      }
      current += char;
    }

    if (current.trim()) {
      result.push(current);
    }

    return result;
  }

  /**
   * Extract code examples from markdown content.
   */
  extractCodeExamples(content: string): string[] {
    const examples: string[] = [];
    const codeBlockRegex = /```(?:js|javascript|ts|typescript)?\n([\s\S]*?)```/g;
    
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const code = match[1].trim();
      if (code) {
        examples.push(code);
      }
    }

    return examples;
  }

  /**
   * Check if text matches a pattern.
   */
  matches(text: string, patternName: string): boolean {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      throw new Error(`Unknown pattern: ${patternName}`);
    }
    return pattern.test(text);
  }
}

/**
 * Default pattern extractor instance.
 */
export const defaultExtractor = new PatternExtractor();