# Tasks: enum-class-member-extraction

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~150-200 |
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
| 1 | Add selectors + href regex in fetcher | PR 1 | selectors.ts + fetcher.ts core changes |
| 2 | Add text normalization + tests | PR 1 | normalization + unit/integration tests |

## Phase 1: Add Selector Chains (selectors.ts)

- [x] 1.1 Add `enumMemberTable` selector: `{ field: "enumMemberTable", primary: "table.member-table tr, table tr.enum-member", fallbacks: [...] }`
- [x] 1.2 Add `enumMemberValue` selector: `{ field: "enumMemberValue", primary: ".enum-member-value, code.value", fallbacks: [...] }`
- [x] 1.3 Add `classMemberSignature` selector: `{ field: "classMemberSignature", primary: "h3.method-title, h3[data-method], .method h3", fallbacks: [...] }`

## Phase 2: Href Regex for getClass (fetcher.ts)

- [x] 2.1 In `getClass`: replace `name.includes(className)` with href regex pattern `/\/{className}\/(methods|properties|static)\//`
- [x] 2.2 Create `methodPattern` and `propertyPattern` RegExp objects using className interpolation
- [x] 2.3 Add HTML fallback trigger: when `methods.length === 0 && properties.length === 0`, fetch HTML and extract members via `classMemberSignature` selector
- [x] 2.4 Ensure fallback extraction distinguishes methods vs properties via signature pattern matching

## Phase 3: getEnum HTML Scraping Primary (fetcher.ts)

- [x] 3.1 In `getEnum`: make HTML scraping mandatory for member extraction (sitemap used only for URL verification)
- [x] 3.2 After sitemap lookup for enum URL, fetch HTML page and load with cheerio
- [x] 3.3 Apply `enumMemberTable` selector chain to extract member rows
- [x] 3.4 Apply `enumMemberValue` selector to extract values from each row
- [x] 3.5 Return `EnumDoc` with extracted members (not just enum name)

## Phase 4: Text Normalization (fetcher.ts)

- [x] 4.1 Add normalization function to clean deprecated artifacts: `deprecatedexternal. GuildBans = 4` → `GuildBans = 4`
- [x] 4.2 Apply normalization to enum member values after extraction
- [x] 4.3 Apply normalization to class member signatures in HTML fallback path
- [x] 4.4 Handle edge case: external enum members with `.` in value names

## Phase 5: Unit Tests (discordjs-bugfixes.test.ts)

- [x] 5.1 Add unit test: href regex pattern matching — verify `/Client/(methods|properties|static)/.test("/classes/Client/methods/login")` returns true
- [x] 5.2 Add unit test: href regex negative case — verify `/Client/(methods|properties|static)/.test("/classes/ClientLoginHelper/methods/login")` returns false
- [x] 5.3 Add unit test: SelectorChain `enumMemberValue` extraction from mocked HTML with table structure
- [x] 5.4 Add unit test: text normalization removes `deprecatedexternal.` prefix cleanly

## Phase 6: Integration Tests

- [x] 6.1 Add integration test: `getEnum` with mocked sitemap returns enum with members from HTML scraping
- [x] 6.2 Add integration test: `getClass` with flat sitemap (href like `methods/login`) triggers HTML fallback and returns methods/properties
- [x] 6.3 Add integration test: `getClass` with structured sitemap (href like `/classes/Client/methods/login`) uses href regex directly without fallback

## Phase 7: Verification

- [x] 7.1 Run existing test suite — all tests pass
- [x] 7.2 Verify `getEnum` returns EnumDoc with `members` array populated (not empty)
- [x] 7.3 Verify `getClass` returns ClassDoc with non-empty `methods` and/or `properties` arrays
- [x] 7.4 Verify no regression: existing enum and class lookups still work when sitemap is well-structured

## Open Questions Resolution

- [x] 8.1 Resolve: Verify enum page HTML structure contains `h2:contains("Members")` — confirm selector chain will match
- [x] 8.2 Resolve: Check if `deprecatedexternal.` artifact appears in actual discord.js.org HTML or only in specific package versions