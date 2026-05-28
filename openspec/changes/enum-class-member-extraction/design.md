# Design: Fix Enum/Class Member Extraction

## Technical Approach

Fix two critical bugs where `getEnum` returns only enum name without members, and `getClass` returns empty methods/properties arrays. Root cause: sitemap is FLAT (no parent-child hierarchy) so `name.includes(className)` and href member lookups fail entirely.

**Strategy:**
1. **Vector A (getEnum)**: Use sitemap only to verify enum exists → fetch HTML page → parse with selector chain → normalize deprecated artifacts
2. **Vector B (getClass)**: Replace `name.includes(className)` with href regex pattern `/\/{className}\/(methods|properties|static)\//` → HTML fallback when methods+properties are empty

## Architecture Decisions

### Decision: getEnum member extraction — HTML scraping primary

**Choice**: Mandatory HTML DOM scraping for member extraction (sitemap used only for URL verification)
**Alternatives considered**: Continue sitemap-only extraction (fails on flat sitemap); hybrid sitemap+HTML (unreliable)
**Rationale**: Sitemap is flat — member entries aren't linked to parent enum via path hierarchy. Only HTML DOM contains structured member data under `h2:contains("Members")`.

### Decision: getClass member matching — href regex over name.includes

**Choice**: Replace `item.name.toLowerCase().includes(className)` with href regex `/\/{className}\/(methods|properties|static)\//`
**Alternatives considered**: name.includes (fails on flat sitemap); fuzzy name matching (unreliable for "Client.login")
**Rationale**: Sitemap items include class path in href: `/classes/Client/methods/login`. Name includes would match "ClientLoginHelper" incorrectly. Href regex is precise and matches actual API structure.

### Decision: HTML fallback trigger for class member extraction

**Choice**: Trigger HTML fallback when `methods.length === 0 && properties.length === 0`
**Alternatives considered**: Always fetch HTML (expensive); no fallback (incomplete)
**Rationale**: Low false-positive rate — if both arrays are empty after sitemap scan, the sitemap structure likely doesn't support href matching. HTML parsing provides complete data at cost of extra fetch.

## Data Flow

```
getEnum(className):
  sitemap → find enumItem (name match) → get URL
  HTML fetch → cheerio.load
  SelectorChain(enumMemberTable) → extract rows
  SelectorChain(enumMemberValue) → extract values
  Normalize text (remove deprecatedexternal.) → return EnumDoc

getClass(className):
  sitemap → find classItem (name match)
  sitemap.filter(href regex: /\/{className}\/(methods|properties|static)\//)
  → if empty: HTML fallback → h2:contains("Methods") ~ h3 pattern
  → return ClassDoc with methods/properties
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mcp-discordjs/src/fetcher.ts` | Modify | Rewrite `getEnum` member extraction; replace `name.includes` with href regex in `getClass` |
| `packages/mcp-discordjs/src/selectors.ts` | Modify | Add `enumMemberTable`, `enumMemberValue`, `classMemberSignature` selector chains |
| `packages/mcp-discordjs/__tests__/unit/discordjs-bugfixes.test.ts` | Modify | Add unit tests for href regex, HTML scraping integration |

## Interfaces / Contracts

### New Selector Chains (selectors.ts)

```typescript
// Enum member extraction
enumMemberTable: {
  field: "enumMemberTable",
  primary: "table.member-table tr, table tr.enum-member",
  fallbacks: ["table tr:has(td)", "[class*='member'] tr", ".enum-members li"],
}

enumMemberValue: {
  field: "enumMemberValue",
  primary: ".enum-member-value, code.value",
  fallbacks: ["td:nth-child(2)", "[class*='value']"],
}

// Class member extraction from HTML fallback
classMemberSignature: {
  field: "classMemberSignature",
  primary: "h3.method-title, h3[data-method], .method h3",
  fallbacks: ["h3[id*='method']", ".section-methods h3"],
}
```

### getClass Href Regex Pattern

```typescript
// Replace name.includes() with href regex
const methodPattern = new RegExp(`/${className}/(methods|static)/`, "i");
const propertyPattern = new RegExp(`/${className}/(properties|static)/`, "i");

const methods = sitemap.filter(item =>
  propertyPattern.test(item.href) && item.kind === "Method"
);
```

### getEnum HTML Scraping (existing scrapeEnumMembers already in fetcher.ts)

The existing `scrapeEnumMembers` method (line 1690) will be enhanced with better selector chains and normalization of deprecated artifacts (e.g., `deprecatedexternal. GuildBans = 4` → `GuildBans = 4`).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | href regex pattern matching | Test regex against mock hrefs: `/\/Client\/(methods|properties|static)\//.test("/classes/Client/methods/login")` |
| Unit | SelectorChain enum member extraction | Mock cheerio with HTML containing enum table |
| Integration | getEnum HTML fallback | Mock HTTP 200 with real enum HTML structure |
| Integration | getClass method/property extraction | Mock flat sitemap + HTML fallback response |

## Migration / Rollback

**No migration required** — internal behavior change only, no data migration.

**Rollback**: Revert `fetcher.ts` and `selectors.ts` to pre-change commits. NPM version unchanged. Tests will fail as detection mechanism.

## Open Questions

- [ ] Verify enum page HTML structure contains `h2:contains("Members")` — confirm selector chain will match
- [ ] Check if `deprecatedexternal.` artifact appears in actual discord.js.org HTML or only in specific package versions