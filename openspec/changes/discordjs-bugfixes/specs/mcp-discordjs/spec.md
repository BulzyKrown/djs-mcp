# Delta for mcp-discordjs (discordjs-bugfixes)

## MODIFIED Requirements

### Requirement: search_docs MUST Use HTML Scraping as Primary Data Source

(Previously: sitemap API primary with HTML fallback)

The system SHALL treat HTML scraping as the primary data source for `search_docs`. When the sitemap API returns empty or fails, the system SHALL immediately scrape the HTML documentation page to find matching items.

The system SHALL attempt HTML scraping when:
- Sitemap API returns empty array
- Sitemap API request fails with network error
- Sitemap API returns null or non-array

#### Scenario: search_docs with HTML scraping primary

- GIVEN user calls `search_docs(query: "Client", package: "discord.js")`
- WHEN sitemap API returns empty array
- THEN the system SHALL scrape the HTML documentation page directly
- AND return matching items extracted from the rendered HTML

#### Scenario: search_docs with typo tolerance on HTML scrape

- GIVEN user calls `search_docs(query: "Cliet", package: "discord.js")`
- WHEN HTML scraping is used as primary
- THEN the system SHALL apply typo-tolerant matching against HTML-parsed item names
- AND return results with edit distance ≤ 2

#### Scenario: search_docs API succeeds

- GIVEN sitemap API returns valid results
- WHEN `search_docs(query: "send", package: "rest")` is called
- THEN the system SHALL return API results directly

---

### Requirement: get_class MUST Extract Properties and Methods Using Name-Based Matching

(Previously: href pattern `/ClassName/` required for property/method extraction)

The system SHALL use name-based matching to extract class members regardless of URL structure. Property and method items SHALL be matched when their name contains or starts with the class name, not relying solely on href path patterns.

#### Scenario: get_class extracts properties with name-based matching

- GIVEN `Client` class exists in sitemap with properties at varying href paths
- WHEN `get_class(className: "Client", package: "discord.js")` is called
- THEN properties SHALL be extracted when `item.name` contains "Client" AND `item.kind` is "Property"
- AND href pattern matching SHALL NOT be the sole filtering criterion

#### Scenario: get_class extracts methods with name-based matching

- GIVEN `Client` class exists in sitemap with methods at varying href paths
- WHEN `get_class(className: "Client", package: "discord.js")` is called
- THEN methods SHALL be extracted when `item.name` contains "Client" AND `item.kind` is "Method"
- AND static methods SHALL be identified via `item.kind === "Method (Static)"` or href containing "/static/"

#### Scenario: get_class returns empty properties array when no matches

- GIVEN `SomeClass` exists but has no matching properties/methods in sitemap
- WHEN `get_class(className: "SomeClass", package: "discord.js")` is called
- THEN the system SHALL return empty arrays for both `properties` and `methods`
- AND the class document SHALL still contain the class name and URL

---

### Requirement: get_enum MUST Extract Members from HTML When Sitemap Patterns Fail

(Previously: sitemap href pattern matching only, no HTML fallback)

The system SHALL fall back to HTML scraping to extract enum members when sitemap-based extraction returns only the enum name without members.

For href patterns containing `NAME=VALUE`, the system SHALL extract both member name and numeric/string value.

#### Scenario: get_enum extracts members from HTML

- GIVEN `ChannelTypes` enum exists with members at varying href paths
- WHEN `get_enum(enumName: "ChannelTypes", package: "rest")` is called
- AND sitemap member patterns do not match
- THEN the system SHALL scrape the enum's HTML documentation page
- AND extract member names and values from the rendered content

#### Scenario: get_enum extracts numeric value from href

- GIVEN sitemap item has `href: "ChannelTypes.TEXT=0"`
- WHEN `getEnum` processes the item
- THEN the member SHALL have `name: "TEXT"` and `value: 0` (number type)

#### Scenario: get_enum extracts string value from href

- GIVEN sitemap item has `href: "GatewayDispatchEvents.DISPATCH=ready"`
- WHEN `getEnum` processes the item
- THEN the member SHALL have `name: "DISPATCH"` and `value: "ready"` (string type)

#### Scenario: get_enum returns name-only fallback

- GIVEN `SomeEnum` exists but member extraction fails completely
- WHEN `get_enum(enumName: "SomeEnum", package: "discord.js")` is called
- THEN the system SHALL return the enum with at least one member: `{ name: enumName, value: enumName, description: enumKind }`

---

### Requirement: get_entrypoints MUST Use Updated Selectors for Current discord.js.org Structure

(Previously: selectors did not match current HTML structure)

The system SHALL update `DISCORD_DOCS_SELECTORS.entrypoints` and `DISCORD_DOCS_SELECTORS.entrypointLinks` to match the current discord.js.org HTML structure.

The selectors SHALL be verified against browser dev tools and SHALL include fallback chains for resilience.

#### Scenario: get_entrypoints returns results from HTML

- GIVEN discord.js.org HTML structure has changed
- WHEN `get_entrypoints(package: "ws", clientId: "test")` is called
- AND the entrypoints API returns empty
- THEN the system SHALL use current selectors to extract entrypoint names from HTML
- AND return non-empty array of entrypoint names

#### Scenario: get_entrypoints uses API when available

- GIVEN entrypoints API returns `["WebSocketManager", "WebSocketShard"]`
- WHEN `get_entrypoints(package: "ws", clientId: "test")` is called
- THEN the API result SHALL be returned without HTML scraping

---

### Requirement: Package Filter MUST Correctly Filter Results by Package Version

(Previously: package filter was ignored)

The system SHALL ensure the `package` parameter flows correctly through all fetcher methods and the version is correctly detected per package.

The system SHALL use the correct package-specific version when querying the sitemap API.

#### Scenario: Package filter limits results to specified package

- GIVEN user calls `search_docs(query: "Client", package: "builders")`
- WHEN the `builders` package version is detected
- THEN only results from the `builders` package sitemap SHALL be returned
- AND results SHALL NOT include items from `discord.js` or other packages

#### Scenario: Version detected per package

- GIVEN user queries `get_class(className: "Channel", package: "discord.js")`
- AND separately `get_class(className: "Builder", package: "builders")`
- WHEN each package has a different latest version
- THEN each query SHALL use its respective package's version
- AND version SHALL be fetched via `getLatestVersion(packageName)`

---

### Requirement: get_interface and get_type MUST Not Return Null When Implementation Exists

(Previously: returning null despite existing implementation)

The system SHALL debug and fix the condition causing `get_interface` and `get_type` to return null.

The sitemap lookup for interfaces and types SHALL be fixed to correctly match `item.kind === "Interface"` and `item.kind === "TypeAlias"` or `item.kind === "Type"`.

#### Scenario: get_interface returns interface document

- GIVEN `RESTEvents` interface exists in sitemap with `kind: "Interface"`
- WHEN `get_interface(interfaceName: "RESTEvents", package: "rest")` is called
- THEN the system SHALL return an `InterfaceDoc` object with properties and methods
- AND the result SHALL NOT be null

#### Scenario: get_type returns type alias document

- GIVEN `Snowflake` type alias exists in sitemap with `kind: "TypeAlias"`
- WHEN `get_type(typeName: "Snowflake", package: "discord.js")` is called
- THEN the system SHALL return a `TypeAliasDoc` object with name, description, and type
- AND the result SHALL NOT be null

#### Scenario: get_interface returns null when not found

- GIVEN `NonExistent` interface does not exist in sitemap
- WHEN `get_interface(interfaceName: "NonExistent", package: "discord.js")` is called
- THEN the system SHALL return null
- AND log a debug message indicating interface was not found

---

### Requirement: Diagnostic Logging for Data Source Selection

The system SHALL log which data source is used (sitemap API vs HTML scraping) and any selector failures to aid debugging.

When falling back from API to HTML, the system SHALL log a warning with the reason.

#### Scenario: Data source logged on fallback

- GIVEN sitemap API returns empty array for `search_docs`
- WHEN `search_docs` falls back to HTML scraping
- THEN the system SHALL log a warning with `{ source: "html", reason: "sitemap_empty" }`

#### Scenario: Selector failure logged

- GIVEN all selectors in a chain fail to match during HTML scraping
- WHEN the scraping operation completes
- THEN the system SHALL log which selectors failed for debugging

## ADDED Requirements

### Requirement: Source Field in Results

When HTML scraping is used as primary or fallback, the result metadata SHALL include a `source` field indicating `"sitemap"` or `"html"`.

#### Scenario: Source field populated

- GIVEN `search_docs` uses HTML scraping as primary
- WHEN results are returned
- THEN each result SHALL contain `source: "html"`
- AND results from sitemap API SHALL contain `source: "sitemap"`