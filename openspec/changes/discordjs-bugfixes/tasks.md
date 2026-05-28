# Tasks: discordjs-bugfixes

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~180-220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Chain strategy | single-pr |
| Delivery strategy | ask-on-risk |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: single-pr
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add new selectors + per-package version detection | PR 1 | selectors.ts + version-detector.ts additions |
| 2 | Invert fetcher data flow + debug logging | PR 1 | fetcher.ts changes (single PR) |

## Phase 1: New Selectors (selectors.ts)

- [x] 1.1 Add `enumMemberName` selector: `{ primary: ".enum-member-name, .member-name", fallbacks: [...] }`
- [x] 1.2 Add `enumMemberValue` selector: `{ primary: ".enum-member-value, code.value", fallbacks: [...] }`
- [x] 1.3 Add `classMethodItem` selector: `{ primary: ".method-item, .method-list li", fallbacks: [...] }`
- [x] 1.4 Add `classPropertyItem` selector: `{ primary: ".property-item, .properties li", fallbacks: [...] }`

## Phase 2: Per-Package Version Detection (version-detector.ts)

- [x] 2.1 Add `detectVersion(packageName)` method to `VersionDetector` class
- [x] 2.2 `detectVersion` should check `@discordjs/{packageName}/package.json` for version
- [x] 2.3 Fall back to scraping `https://discord.js.org/docs/packages/{packageName}` if package.json not found
- [x] 2.4 Cache per-package version results with 24h TTL

## Phase 3: Fetcher — Invert Data Source Priority (fetcher.ts)

- [x] 3.1 In `search_docs`: make HTML scrape primary, API fallback — add debug log when API returns empty
- [x] 3.2 In `getClass`: replace href-based method/property matching with name-based matching (check `item.name.startsWith(className)` or `item.name.includes(className)`)
- [x] 3.3 In `getEnum`: add HTML scrape fallback to extract enum members when sitemap is missing member entries
- [x] 3.4 In `getEntryPoints`: ensure HTML scrape fallback is wired correctly (already has try/catch fallback)
- [x] 3.5 In `getInterface`/`getType`: add null return logging for debugging empty results
- [x] 3.6 In `getLatestVersion`: use per-package version detection instead of shared discord.js version for non-discord.js packages

## Phase 4: Testing

- [x] 4.1 Add unit test: `getClass` name-based matching when sitemap href lacks class path (mock sitemap with href like `methods/login` vs `classes/Client/login`)
- [x] 4.2 Add unit test: `getEnum` extracts values from HTML when sitemap is missing member entries
- [x] 4.3 Add unit test: `detectVersion` returns different versions for different packages (mock builders@14.26.4 vs discord.js@14.27.0)
- [x] 4.4 Add integration test: `search_docs` with empty API response verifies HTML fallback is used (mock API returning `[]`, verify HTML scrape is called)

## Phase 5: Index Wiring (index.ts)

- [x] 5.1 Verify `DiscordDocsFetcher` exports align with changed method signatures (no API contract changes expected)