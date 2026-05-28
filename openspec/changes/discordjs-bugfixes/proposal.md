# Proposal: Fix Critical Bugs in mcp-discordjs MCP Server

## Intent

Six MCP tools return empty/null for valid queries, making the server unusable for discord.js documentation lookup. Root cause: the sitemap API fails silently while direct HTML scraping succeeds. We must invert the data source strategy and fix href pattern matching.

## Scope

### In Scope
- Invert data source: HTML scraping becomes primary, API becomes fallback
- Fix `search_docs` to use HTML search when sitemap API returns empty
- Fix `get_class` empty properties/methods: update href patterns to match actual sitemap structure
- Fix `get_enum` to extract members from HTML when sitemap member patterns don't match
- Fix `get_entrypoints` selectors to match current discord.js.org HTML structure
- Fix `get_interface` and `get_type` that return null despite existing implementations
- Add debug logging for diagnosis during development
- Ensure package filtering works with correct version detection

### Out of Scope
- New capabilities or features
- Changes to MCP SDK or transport layer
- Performance optimization (deferred to future work)

## Capabilities

### Modified Capabilities
- `search_docs`: Delta spec needed — change fallback behavior when sitemap returns empty
- `get_class`: Delta spec needed — fix href pattern matching for properties/methods extraction
- `get_enum`: Delta spec needed — fix member extraction when sitemap patterns don't match
- `get_entrypoints`: Delta spec needed — update selectors for current discord.js.org structure
- `get_interface`: Delta spec needed — fix null return despite implementation existing
- `get_type`: Delta spec needed — fix null return despite implementation existing

## Approach

**Strategy: Primary HTML with API fallback**

1. **Change data source priority**: When sitemap API returns empty array, fall back to HTML scraping immediately rather than returning empty results
2. **Fix selector chain**: Update `DISCORD_DOCS_SELECTORS` to match current discord.js.org HTML structure (use browser dev tools to verify current selectors)
3. **Name-based href matching**: Replace pattern-based href matching (e.g., `/Client/`) with name-based matching that works regardless of URL structure
4. **Enum member extraction**: Parse enum member pages directly from HTML rather than relying on sitemap href patterns
5. **Add diagnostic logging**: Log which data source used (sitemap vs HTML) and any selector failures to aid debugging

**Files to modify**:
- `packages/mcp-discordjs/src/fetcher.ts` — invert data source strategy, fix href patterns
- `packages/mcp-discordjs/src/selectors.ts` — update selectors for current HTML structure
- `packages/mcp-discordjs/src/index.ts` — ensure package parameter flows correctly

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mcp-discordjs/src/fetcher.ts` | Modified | Core logic changes for HTML-primary strategy and href pattern fixes |
| `packages/mcp-discordjs/src/selectors.ts` | Modified | Update selectors to match current discord.js.org HTML |
| `packages/mcp-discordjs/src/index.ts` | Modified | Ensure package filtering works end-to-end |
| `openspec/changes/discordjs-bugfixes/specs/` | New | Delta specs for modified capabilities |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| HTML structure changes break selectors | Medium | Use multi-selector chain with fallbacks; log when selectors fail |
| API returns stale data masking real failures | Low | Add explicit "source" field to results indicating data origin |
| Enum member extraction still fails | Medium | Fall back to returning enum name-only with warning |

## Rollback Plan

1. Revert `fetcher.ts` to previous version from git
2. Revert `selectors.ts` to previous version
3. Revert `index.ts` if changed
4. All changes are additive — no destructive operations
5. NPM package version unchanged, no breaking changes

## Dependencies

- `cheerio` (already in use) — HTML parsing
- `selectors.ts` (already in use) — selector chain infrastructure

## Success Criteria

- [ ] `search_docs("Client")` returns non-empty results for discord.js package
- [ ] `get_class("Client")` returns properties and methods arrays (not empty)
- [ ] `get_enum("ChannelTypes")` returns all enum members with correct values
- [ ] `get_entrypoints("ws")` returns non-empty array of entrypoint names
- [ ] `get_interface("RESTEvents")` returns interface doc (not null)
- [ ] `get_type("Snowflake")` returns type doc (not null)
- [ ] Package filter actually limits results to specified package
- [ ] All existing tests pass