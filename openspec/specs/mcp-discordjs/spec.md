# Delta for mcp-discordjs

## ADDED Requirements

### Requirement: Explicit Package Parameter for Low-level Packages

The MCP tools SHALL require an explicit `package` parameter when the query targets `@discordjs/*` low-level packages (core, rest, ws). The system SHALL NOT silently fall back to "discord.js" for these packages.

When `package` is absent for a low-level package query, the system SHALL log a warning indicating explicit package selection is required.

#### Scenario: Search with explicit low-level package

- GIVEN user project uses `@discordjs/core@2.4.0`
- WHEN `search_docs(query: "send", package: "core")` is called
- THEN results from the core package sitemap are returned
- AND the package field in results reflects "core"

#### Scenario: Search without package for low-level package

- GIVEN user queries without specifying package
- WHEN `search_docs(query: "send")` is called
- THEN results default to discord.js package
- AND a warning is logged that explicit package is recommended for low-level packages

---

### Requirement: HTML Scraping Fallback for getEntryPoints()

When the entrypoints API returns an empty array, the system SHALL fall back to HTML scraping using the selector chain defined in `selectors.ts`.

The scraping SHALL use `DISCORD_DOCS_SELECTORS` primary/fallback selectors to extract entrypoint names from the rendered documentation page.

#### Scenario: Entrypoints API returns empty array

- GIVEN the entrypoints API for `@discordjs/ws` returns `[]`
- WHEN `getEntryPoints(package: "ws", clientId: "test")` is called
- THEN the system SHALL fetch the package documentation HTML page
- AND extract entrypoint names using selector chains from `selectors.ts`
- AND return the extracted entrypoint names

#### Scenario: Entrypoints API returns valid data

- GIVEN the entrypoints API for `@discordjs/ws` returns `["WebSocketManager", "WebSocketShard"]`
- WHEN `getEntryPoints(package: "ws", clientId: "test")` is called
- THEN the API result SHALL be returned without scraping

---

### Requirement: HTML Scraping Fallback for getItemDetail()

When the item detail API returns 404 or null, the system SHALL fall back to HTML scraping using the selector chain defined in `selectors.ts`.

The scraping SHALL extract item details (description, properties, methods) from the rendered documentation page.

#### Scenario: Item detail API returns 404

- GIVEN the item detail API for `GatewayDispatchEvents` in `ws` package returns 404
- WHEN `getItemDetail(package: "ws", itemName: "GatewayDispatchEvents", clientId: "test")` is called
- THEN the system SHALL fetch the item's HTML documentation page
- AND extract details using selector chains from `selectors.ts`
- AND return the extracted details

#### Scenario: Item detail API returns valid data

- GIVEN the item detail API returns `{ name: "GatewayDispatchEvents", description: "..." }`
- WHEN `getItemDetail(package: "ws", itemName: "GatewayDispatchEvents", clientId: "test")` is called
- THEN the API result SHALL be returned without scraping

---

### Requirement: Enum Value Extraction from Href Patterns

The system SHALL extract enum member values from sitemap href patterns by parsing the final segment of the URL.

For href patterns containing `NAME=VALUE` (e.g., `GatewayDispatchEvents.DISPATCH=0`), the system SHALL extract both the member name and its numeric or string value.

#### Scenario: Extract numeric enum value from href

- GIVEN sitemap item has `href: "GatewayDispatchEvents.DISPATCH=0"`
- WHEN `getEnum(enumName: "GatewayDispatchEvents", package: "ws")` is called
- THEN the enum member SHALL have `name: "DISPATCH"` and `value: 0`

#### Scenario: Extract string enum value from href

- GIVEN sitemap item has `href: "ChannelTypes.TEXT=0"`
- WHEN `getEnum(enumName: "ChannelTypes", package: "rest")` is called
- THEN the enum member SHALL have `name: "TEXT"` and `value: 0`

#### Scenario: Extract enum member without explicit value

- GIVEN sitemap item has `href: "GatewayDispatchEvents.UNKNOWN"`
- WHEN the href does not contain `=` sign
- THEN the enum member SHALL have `name` derived from the final path segment
- AND `value` SHALL default to the member name

---

### Requirement: Package Version Detection from package.json

The system MAY detect the installed version of `@discordjs/*` packages from the user's `package.json` file in the project context.

When version is detected, the system SHALL use that version for API queries instead of the latest known version.

#### Scenario: Detect version from package.json

- GIVEN user's `package.json` contains `"@discordjs/core": "2.4.0"`
- WHEN `search_docs(query: "send", package: "core")` is called
- THEN the system SHALL use version `2.4.0` for API queries
- AND log that version was detected from package.json

#### Scenario: Package.json version not available

- GIVEN user's `package.json` does not contain `@discordjs/core`
- WHEN `search_docs(query: "send", package: "core")` is called
- THEN the system SHALL fall back to latest known version
- AND proceed without error

---

### Requirement: Graceful Handling of Missing/Incomplete Data

The system SHALL handle missing or incomplete API data gracefully without throwing unhandled errors.

When scraping or API calls fail, the system SHALL return empty results or null as appropriate, with appropriate warning logs.

#### Scenario: Sitemap returns null

- GIVEN the sitemap API returns `null` or non-array
- WHEN any search operation is performed
- THEN the system SHALL return an empty array
- AND log a warning about the invalid sitemap

#### Scenario: All scraping selectors fail

- GIVEN all selector chains in `selectors.ts` fail to match
- WHEN HTML scraping fallback is triggered
- THEN the system SHALL return empty/null results
- AND log which selectors failed for debugging

---

### Requirement: CDN Data Source on Startup

The system SHALL fetch documentation from the CDN source `https://raw.githubusercontent.com/discordjs/docs/main/discord.js/main.json` during server initialization.

The system SHALL parse the fetched JSON and index all documentation items in memory.

#### Scenario: Successful CDN fetch on startup

- GIVEN the MCP server is started
- WHEN initialization occurs
- THEN the system SHALL fetch `https://raw.githubusercontent.com/discordjs/docs/main/discord.js/main.json`
- AND parse the response as JSON
- AND index all items in RAM for local querying

#### Scenario: CDN fetch fails on startup

- GIVEN the CDN endpoint is unreachable
- WHEN the server attempts initialization
- THEN the system SHALL log an error with details
- AND the server MAY continue with empty index
- AND subsequent queries SHALL return empty results without throwing

---

### Requirement: In-Memory Documentation Index

The system SHALL maintain an in-memory index of all documentation items after initial CDN fetch.

All subsequent queries (search, get_class, get_enum, etc.) SHALL be served from the local index with zero network requests.

#### Scenario: Query served from local index

- GIVEN the CDN data has been fetched and indexed
- WHEN `search_docs(query: "Client")` is called
- THEN the search SHALL be performed against the in-memory index
- AND no network request SHALL be made to discord.js.org

#### Scenario: Index persists across multiple queries

- GIVEN the CDN data has been fetched
- WHEN multiple queries are made in sequence
- THEN all queries SHALL use the same in-memory index
- AND response times SHALL be < 10ms for each query

---

### Requirement: Jaro-Winkler Fuzzy Search

The system SHALL use Jaro-Winkler similarity algorithm for fuzzy matching in search operations.

The fuzzy search SHALL provide typo tolerance with accuracy suitable for identifier matching.

#### Scenario: Fuzzy match with typo

- GIVEN indexed documentation contains "Client" class
- WHEN `search_docs(query: "Clinet")` is called (typo: 'i' instead of 'i')
- THEN "Client" SHALL appear in results with high score
- AND results SHALL be sorted by relevance

#### Scenario: Exact match ranks higher

- GIVEN indexed documentation contains "Client" class
- WHEN `search_docs(query: "Client")` is called
- THEN exact match SHALL rank first
- AND fuzzy matches SHALL rank lower

---

### Requirement: Backward Compatibility with Existing MCP Tools

The system SHALL maintain the same MCP tool interfaces and return types as before the change.

All existing tools (search_docs, get_class, get_enum, get_interface, etc.) SHALL function identically using the new CDN source.

#### Scenario: search_docs returns same format

- GIVEN CDN data is indexed
- WHEN `search_docs(query: "send", package: "discord.js")` is called
- THEN results SHALL have type `DocResult[]`
- AND each result SHALL have `title`, `description`, `url`, `type`, `package` fields

#### Scenario: get_class returns same ClassDoc structure

- GIVEN CDN data is indexed
- WHEN `getClass(className: "Client", package: "discord.js")` is called
- THEN result SHALL have type `ClassDoc`
- AND include `name`, `description`, `properties`, `methods`, `extends`, `package`, `url`

---

### Requirement: Package-Scoped Indexing

The system SHALL index documentation per package, allowing package-specific queries.

The system SHALL support the same packages as before: discord.js, builders, collection, core, rest, voice, ws, structures, util, formatters.

#### Scenario: Query scoped to specific package

- GIVEN CDN data is indexed for multiple packages
- WHEN `search_docs(query: "Client", package: "core")` is called
- THEN results SHALL only include items from the "core" package
- AND items from "discord.js" SHALL NOT appear

---

### Requirement: Graceful Degradation

When the CDN source is unavailable or data is missing, the system SHALL NOT crash.

The system SHALL log appropriate warnings and return empty/null results as appropriate.

#### Scenario: Empty index returns empty search results

- GIVEN CDN fetch failed and index is empty
- WHEN `search_docs(query: "Client")` is called
- THEN result SHALL be an empty array `[]`
- AND no error SHALL be thrown to the MCP client

#### Scenario: Missing class returns null

- GIVEN CDN data is indexed
- WHEN `getClass(className: "NonExistent")` is called
- THEN result SHALL be `null`
- AND no error SHALL be thrown