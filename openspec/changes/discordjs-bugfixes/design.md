# Design: discordjs-bugfixes

## Technical Approach

Invert data source priority: **HTML scraping is PRIMARY**, API is fallback. The current API-first approach fails silently when the API returns empty or malformed data. By making HTML scraping primary, we ensure data is always available and the API just provides cached stale data when available.

## Architecture Decisions

### Decision: HTML-First Data Retrieval

**Choice**: Fetch from HTML scraping first, use API response only as cached stale data fallback
**Alternatives considered**: Continue API-first with better error logging; Use parallel fetch with race condition
**Rationale**: API failures produce silent empty results. HTML scraping is more resilient to API changes and provides richer structured data.

### Decision: Debug Logging for API Responses

**Choice**: Log raw API response size and structure when `search_docs` returns empty
**Alternatives considered**: Throw error on API failure; Silent fallback
**Rationale**: Without visibility into what the API returns, bugs are invisible. Logging the response shape helps diagnose whether the issue is API behavior vs selector mismatch.

### Decision: Name-Based Matching for Methods/Properties

**Choice**: Match methods/properties by checking if item name starts with or contains the class name, not just href pattern
**Alternatives considered**: Rely solely on href structure `/${className}/`; Fuzzy name matching
**Rationale**: The sitemap href structure doesn't consistently contain the class name path. Name-based matching is more robust.

### Decision: Version Detection Per-Package

**Choice**: Each package needs its own version detection, not shared `discord.js` version
**Alternatives considered**: Use single global version; Fallback to hardcoded version
**Rationale**: Package versions diverge (builders@14.26.4 vs discord.js@14.27.0). Using wrong version causes sitemap lookup to return 404 or empty.

## Data Flow

```
search_docs(query, package)
    │
    ▼
getLatestVersion(package)  ──→ version-detector.ts (per-package)
    │
    ▼
scrapeFromHTML(package, version)  ──→ PRIMARY SOURCE
    │                              │
    │                              ▼
    │                         selectors.ts extracts
    │                              │
    ▼                              ▼
API fetch (fallback)           Return results
    │                              │
    ▼                              ▼
Return cached stale data     ────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/fetcher.ts` | Modify | Invert priority: HTML scrape first, API as fallback |
| `src/fetcher.ts` | Modify | Add debug logging for empty search results |
| `src/fetcher.ts` | Modify | Fix `getClass` to use name-based method/property matching |
| `src/fetcher.ts` | Modify | Fix `getEnum` to extract members from HTML when sitemap fails |
| `src/fetcher.ts` | Modify | Fix `getEntryPoints` with correct HTML selectors |
| `src/fetcher.ts` | Modify | Fix `getInterface`/`getType` null returns |
| `src/fetcher.ts` | Modify | Per-package version detection in `getLatestVersion` |
| `src/selectors.ts` | Modify | Add selectors for enum member values, class method/property extraction |
| `src/version-detector.ts` | Modify | Add `detectVersion(packageName)` for per-package versions |

## Interfaces / Contracts

No new interfaces. Changes are internal to `DiscordDocsFetcher`:

### Changed Methods

```typescript
// fetcher.ts - getClass signature unchanged but implementation uses name-based matching
async getClass(className: string, packageName?: string, clientId?: string): Promise<ClassDoc | null>

// fetcher.ts - now scrapes HTML primarily instead of API
async getEntryPoints(packageName: string, clientId: string): Promise<string[]>

// version-detector.ts - new method for per-package versions
async detectVersion(packageName: string): Promise<VersionInfo>
```

### New Selectors (selectors.ts)

```typescript
// For enum member value extraction from HTML
enumMemberName: { primary: ".enum-member-name, .member-name", fallbacks: [...] }
enumMemberValue: { primary: ".enum-member-value, code.value", fallbacks: [...] }

// For class method/property extraction from HTML
classMethodItem: { primary: ".method-item, .method-list li", fallbacks: [...] }
classPropertyItem: { primary: ".property-item, .properties li", fallbacks: [...] }
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `getClass` returns methods/properties when sitemap href lacks class path | Mock sitemap with href like `methods/login` vs `classes/Client/login` |
| Unit | `getEnum` extracts values from HTML when sitemap missing members | Mock HTML with enum table, mock empty sitemap |
| Unit | Per-package version detection | Mock different package.json versions |
| Integration | `search_docs` with empty API response | Mock API returning `[]`, verify HTML fallback used |
| Integration | Full flow with real discord.js docs | Live test against actual docs site |

## Migration / Rollout

No migration required. This is a bug fix that changes internal data retrieval behavior without affecting the public API contract.

## Open Questions

- [ ] The `getItemDetail` API endpoint structure is unknown — is there a corresponding HTML page structure to scrape?
- [ ] The `enumMemberValue` selector pattern needs verification against actual discord.js.org HTML structure