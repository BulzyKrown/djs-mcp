/**
 * Unit tests for SelectorChain and PatternExtractor.
 */

import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { SelectorChain, DISCORD_DOCS_SELECTORS, getSelectorChain, extractWithChain } from "../../src/selectors.js";
import { PatternExtractor, COMMON_PATTERNS } from "../../src/patterns.js";

describe("SelectorChain", () => {
  const html = `
    <html>
      <body>
        <h1 class="page-title">Test Title</h1>
        <article>
          <p class="description">Test description</p>
          <div class="properties">
            <div class="property">
              <span class="property-name">prop1</span>
              <span class="property-type">string</span>
              <span class="property-description">First property</span>
            </div>
          </div>
        </article>
      </body>
    </html>
  `;

  describe("basic extraction", () => {
    it("extracts text from primary selector", () => {
      const chain = new SelectorChain({
        field: "title",
        primary: "h1.page-title",
      });
      const $ = cheerio.load(html);
      const result = chain.extract($);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("Test Title");
      expect(result.usedFallback).toBe(false);
    });

    it("falls back to secondary selector when primary fails", () => {
      const chain = new SelectorChain({
        field: "title",
        primary: "h1.does-not-exist",
        fallbacks: ["h1.page-title"],
      });
      const $ = cheerio.load(html);
      const result = chain.extract($);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("Test Title");
      expect(result.usedFallback).toBe(true);
    });

    it("returns failure when all selectors fail", () => {
      const chain = new SelectorChain({
        field: "title",
        primary: "h1.nonexistent",
        fallbacks: ["div.missing"],
      });
      const $ = cheerio.load(html);
      const result = chain.extract($);
      
      expect(result.success).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe("fallback chain behavior", () => {
    it("tries fallbacks in order", () => {
      const chain = new SelectorChain({
        field: "test",
        primary: ".nonexistent",
        fallbacks: [".missing", "h1.page-title", "h1.other"],
      });
      const $ = cheerio.load(html);
      const result = chain.extract($);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("Test Title");
      expect(result.selector).toBe("h1.page-title");
      expect(result.usedFallback).toBe(true);
    });

    it("respects max 4 selectors limit", () => {
      const chain = new SelectorChain({
        field: "test",
        primary: "p1",
        fallbacks: ["p2", "p3", "p4", "p5", "p6"],
      });
      
      expect(chain.getSelectors()).toHaveLength(4);
    });
  });

  describe("extractAttribute", () => {
    it("extracts href attribute from links", () => {
      const linkHtml = '<a href="/docs/test">Link</a>';
      const chain = new SelectorChain({
        field: "link",
        primary: "a",
      });
      const $ = cheerio.load(linkHtml);
      const result = chain.extractAttribute($, "href");
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("/docs/test");
    });
  });

  describe("exists and count", () => {
    it("exists returns true when selector matches", () => {
      const chain = new SelectorChain({
        field: "title",
        primary: "h1.page-title",
      });
      const $ = cheerio.load(html);
      
      expect(chain.exists($)).toBe(true);
    });

    it("count returns number of matches", () => {
      const chain = new SelectorChain({
        field: "properties",
        primary: ".property",
      });
      const $ = cheerio.load(html);
      
      expect(chain.count($)).toBe(1);
    });
  });

  describe("DISCORD_DOCS_SELECTORS", () => {
    it("title chain extracts from h1.page-title", () => {
      const chain = getSelectorChain("title");
      const $ = cheerio.load(html);
      const result = chain.extract($);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("Test Title");
    });

    it("description chain extracts from .description", () => {
      const chain = getSelectorChain("description");
      const $ = cheerio.load(html);
      const result = chain.extract($);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("Test description");
    });

    it("has all required fields defined", () => {
      const requiredFields = [
        "title",
        "description",
        "propertyName",
        "propertyType",
        "propertyDescription",
        "methodSignature",
        "methodReturns",
        "methodParams",
        "codeExamples",
        "navLinks",
        "extends",
      ];

      for (const field of requiredFields) {
        expect(DISCORD_DOCS_SELECTORS).toHaveProperty(field);
        expect(DISCORD_DOCS_SELECTORS[field as keyof typeof DISCORD_DOCS_SELECTORS].primary).toBeDefined();
      }
    });

    it("each selector chain has at most 4 total selectors", () => {
      for (const config of Object.values(DISCORD_DOCS_SELECTORS)) {
        const chain = new SelectorChain({
          field: config.field,
          primary: config.primary,
          fallbacks: [...config.fallbacks],
        });
        expect(chain.getSelectors().length).toBeLessThanOrEqual(4);
      }
    });
  });

  describe("extractWithChain helper", () => {
    it("returns extracted value directly", () => {
      const $ = cheerio.load(html);
      const result = extractWithChain($, {
        field: "title",
        primary: "h1.page-title",
      });
      
      expect(result).toBe("Test Title");
    });

    it("returns null on failure", () => {
      const $ = cheerio.load(html);
      const result = extractWithChain($, {
        field: "nonexistent",
        primary: "div.does-not-exist",
      });
      
      expect(result).toBeNull();
    });
  });
});

describe("PatternExtractor", () => {
  describe("extractParams", () => {
    it("extracts simple parameters", () => {
      const extractor = new PatternExtractor();
      const params = extractor.extractParams("setName(name: string, value: unknown): void");
      
      expect(params).toHaveLength(2);
      expect(params[0]).toEqual({ name: "name", type: "string", optional: false });
      expect(params[1]).toEqual({ name: "value", type: "unknown", optional: false });
    });

    it("handles optional parameters", () => {
      const extractor = new PatternExtractor();
      const params = extractor.extractParams("fetch(id?: string): Promise<Data>");
      
      expect(params).toHaveLength(1);
      expect(params[0]).toEqual({ name: "id", type: "string", optional: true });
    });

    it("handles generic types", () => {
      const extractor = new PatternExtractor();
      const params = extractor.extractParams("getMap(key: string, value: Collection<string>): Map<string, Collection<string>>");
      
      expect(params[1]).toEqual({ name: "value", type: "Collection<string>", optional: false });
    });

    it("handles empty parameter list", () => {
      const extractor = new PatternExtractor();
      const params = extractor.extractParams("clear(): void");
      
      expect(params).toHaveLength(0);
    });
  });

  describe("extractReturnType", () => {
    it("extracts return type after colon", () => {
      const extractor = new PatternExtractor();
      const returnType = extractor.extractReturnType("getName(): string");
      
      expect(returnType).toBe("string");
    });

    it("handles complex return types", () => {
      const extractor = new PatternExtractor();
      const returnType = extractor.extractReturnType("findAll(): Promise<Array<Message>>");
      
      expect(returnType).toBe("Promise<Array<Message>>");
    });
  });

  describe("extractType", () => {
    it("extracts simple types", () => {
      const extractor = new PatternExtractor();
      const type = extractor.extractType("string");
      
      expect(type).toBe("string");
    });

    it("extracts generic types", () => {
      const extractor = new PatternExtractor();
      const type = extractor.extractType("Collection<string>");
      
      expect(type).toBe("Collection<string>");
    });

    it("extracts array types", () => {
      const extractor = new PatternExtractor();
      const type = extractor.extractType("Message[]");
      
      expect(type).toBe("Message[]");
    });
  });

  describe("extractCodeExamples", () => {
    it("extracts code blocks from markdown", () => {
      const extractor = new PatternExtractor();
      const content = `
        Some text here.
        \`\`\`javascript
        const client = new Client();
        client.login('token');
        \`\`\`
        More text.
        \`\`\`typescript
        const msg: Message = await channel.send('Hello');
        \`\`\`\`
      `;
      const examples = extractor.extractCodeExamples(content);
      
      expect(examples).toHaveLength(2);
      expect(examples[0]).toContain("const client = new Client()");
      expect(examples[1]).toContain("const msg: Message");
    });
  });

  describe("register and custom patterns", () => {
    it("registers custom pattern", () => {
      const extractor = new PatternExtractor();
      extractor.register("discordId", /\d{17,19}/);
      
      const result = extractor.extract("My ID is 123456789012345678", "discordId");
      expect(result).toBe("123456789012345678");
    });
  });

  describe("COMMON_PATTERNS", () => {
    it("has methodSignature pattern", () => {
      expect(COMMON_PATTERNS.methodSignature).toBeDefined();
      expect(COMMON_PATTERNS.methodSignature.test("getName(): string")).toBe(true);
    });

    it("has parameterList pattern", () => {
      expect(COMMON_PATTERNS.parameterList).toBeDefined();
      expect(COMMON_PATTERNS.parameterList.exec("(a: string, b: number)")).toBeTruthy();
    });

    it("has version pattern", () => {
      expect(COMMON_PATTERNS.version).toBeDefined();
      expect(COMMON_PATTERNS.version.exec("v14.26.4")).toBeTruthy();
    });
  });
});