/**
 * Helper functions for loading HTML fixtures in selector tests.
 */

import * as cheerio from "cheerio";

/**
 * Load HTML string into Cheerio API.
 */
export function loadHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

/**
 * Create a minimal HTML document with content.
 */
export function createHtmlDocument(body: string, title = "Test Page"): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
</head>
<body>
${body}
</body>
</html>
  `.trim();
}

/**
 * Create a navigation link element for testing.
 */
export function createNavLink(href: string, text: string): string {
  return `<a href="${href}">${text}</a>`;
}

/**
 * Create a property row for testing.
 */
export function createPropertyRow(
  name: string,
  type: string,
  description = ""
): string {
  return `
<div class="property">
  <span class="property-name">${name}</span>
  <span class="property-type">${type}</span>
  <span class="property-description">${description}</span>
</div>
  `.trim();
}

/**
 * Create a method element for testing.
 */
export function createMethodElement(
  name: string,
  signature: string,
  description = ""
): string {
  return `
<div class="method">
  <div class="method-header">
    <span class="method-name">${name}</span>
    <span class="method-signature">${signature}</span>
  </div>
  <div class="method-description">${description}</div>
</div>
  `.trim();
}

/**
 * Create a code block for testing.
 */
export function createCodeBlock(language: string, code: string): string {
  return `
<pre><code class="language-${language}">
${code}
</code></pre>
  `.trim();
}

/**
 * Common HTML fixtures for testing.
 */
export const FIXTURES = {
  simplePage: `
    <h1 class="page-title">Test Title</h1>
    <p class="description">Test description content</p>
    <div class="properties">
      ${createPropertyRow("id", "string", "The ID")}
      ${createPropertyRow("name", "string", "The name")}
    </div>
  `,
  
  navLinks: `
    <nav>
      ${createNavLink("/docs/packages/discord.js", "discord.js")}
      ${createNavLink("/docs/packages/builders", "builders")}
      ${createNavLink("/docs/packages/collection", "collection")}
    </nav>
  `,
  
  classPage: `
    <h1 class="page-title">Client</h1>
    <p class="description">The main Discord client class</p>
    <div class="extends">extends <a href="/docs/structure/Base">Base</a></div>
    <div class="properties">
      ${createPropertyRow("options", "ClientOptions", "Client options")}
      ${createPropertyRow("users", "Collection<Snowflake, User>", "Users cache")}
    </div>
    <div class="methods">
      ${createMethodElement("login", "login(token: string): Promise<this>", "Login to Discord")}
      ${createMethodElement("destroy", "destroy(): void", "Destroy the client")}
    </div>
  `,
  
  methodPage: `
    <h1 class="page-title">Client.login</h1>
    <p class="description">Login to Discord API</p>
    <div class="method-signature">login(token: string): Promise<this></div>
    <div class="method-params">
      ${createPropertyRow("token", "string", "The bot token")}
    </div>
    <div class="method-returns">
      <span class="return-type">Promise&lt;this&gt;</span>
    </div>
    <pre><code>const client = new Client();
await client.login('token');</code></pre>
  `,
};

/**
 * Extract text content from HTML, removing tags.
 */
export function stripHtml(html: string): string {
  const $ = cheerio.load(html);
  return $.text().trim();
}

/**
 * Check if content looks like code.
 */
export function looksLikeCode(text: string): boolean {
  const codeIndicators = [
    /function\s+\w+/,
    /=>/,
    /\w+\.\w+\(/,
    /const\s+\w+/,
    /let\s+\w+/,
    /return\s+/,
    /async\s+/,
    /await\s+/,
    /new\s+\w+/,
  ];
  return codeIndicators.some((pattern) => pattern.test(text));
}