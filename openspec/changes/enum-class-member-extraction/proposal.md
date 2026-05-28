# Proposal: Fix Enum/Class Member Extraction (Vectors A & B)

## Intent

Fix critical bugs where `get_enum` returns only enum name without members, and `get_class` returns empty methods/properties arrays. Root cause: sitemap is FLAT (no parent-child hierarchy) so `name.includes(className)` and sitemap member lookups fail entirely.

## Scope

### In Scope
- **Vector A**: `get_enum` — extract members from HTML DOM (sitemap cannot provide hierarchy)
- **Vector B**: `get_class` — switch from `name.includes()` to **href pattern regex** matching (`/Client/(methods|properties|static)/`)
- Add HTML scraping fallback for class member extraction when href pattern fails
- Normalize extracted text (clean `deprecatedexternal.` artifacts from enum member names)

### Out of Scope
- Changes to MCP protocol or tool interfaces
- Entrypoints fixes (already addressed in v1.3.0)
- Performance optimization (deferred)

## Capabilities

### Modified Capabilities
- `get_enum`: REQUIREMENT CHANGE — now uses HTML DOM scraping for member extraction (not sitemap-only)
- `get_class`: REQUIREMENT CHANGE — now uses href pattern regex matching for member association

## Approach

**Hybrid Resolution Strategy:**

1. **For Enums (Vector A)**:
   - Use sitemap ONLY to verify enum exists and get page URL
   - Mandatory transition to HTML DOM scraping for member extraction
   - Parse HTML structure: `h2:contains("Members") ~ * h3` or table rows
   - Regex cleanup: `deprecatedexternal. GuildBans = 4` → `GuildBans = 4`

2. **For Classes (Vector B)**:
   - Fast-path: sitemap with regex `/ClassName/(methods|properties|static)/` on href
   - Fallback trigger: if class has 0 methods + 0 properties after sitemap scan, fetch HTML and parse `h2:contains("Methods") ~ h3`

**Key Files**:
- `fetcher.ts` — rewrite `getEnum` and `getClass` member matching logic
- `selectors.ts` — add CSS selector chains for member extraction from HTML
- `version-detector.ts` — no changes needed

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/fetcher.ts` | Modified | `getEnum` member extraction + `getClass` method/property matching |
| `src/selectors.ts` | Modified | Add selectors for enum members, class members from HTML |
| `__tests__/unit/discordjs-bugfixes.test.ts` | Modified | Add tests for new matching logic |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| HTML structure changes break selectors | Medium | Multi-selector chain with fallbacks; debug logging |
| Enum members use different HTML structure per package | Medium | Per-package selector chains; fallback to value parsing |
| DOM rendering causes latency spike | Low | Aggressive LRU caching of parsed HTML results |

## Rollback Plan

1. Revert `fetcher.ts` to v1.3.0 git commit
2. Revert `selectors.ts` if selectors changed
3. NPM version unchanged — internal behavior only
4. Tests will fail until rollback complete (detection mechanism)

## Dependencies

- `cheerio` (already in use) — HTML parsing
- `selectors.ts` selector chain infrastructure (already in use)

## Success Criteria

- [ ] `get_enum("GatewayIntentBits")` returns `values: [{name: "Guilds", value: 1}, {name: "GuildMessages", value: 512}, ...]`
- [ ] `get_class("Client")` returns `methods` and `properties` arrays with actual members (not empty)
- [ ] Class method matching uses href pattern regex, not name includes
- [ ] Enum member name normalization removes deprecated/external artifacts
- [ ] All 185 existing tests pass (regression protection)