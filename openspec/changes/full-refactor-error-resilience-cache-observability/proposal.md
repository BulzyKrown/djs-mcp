# Proposal: full-refactor-error-resilience-cache-observability

## Intent

The mcp-discordjs server scrapes discord.js.org documentation with no error handling, unbounded cache growth, fragile selectors, zero observability, or testing. This refactor addresses all ten identified deficiencies in a staged PR chain to preserve reviewability.

## Scope

### In Scope
- **PR 1 (Foundation)**: Typed errors, retry with exponential backoff, circuit breaker pattern
- **PR 2 (Cache + Logging)**: Bounded LRU cache (max 100), structured logger, cache hit/miss metrics
- **PR 3 (Selector Refactor)**: Fallback selector chains, pattern-based extraction, type completeness for getMethod()
- **PR 4 (Server Layer)**: Input validation enforcement, dynamic version detection, rate limiting, pagination
- **PR 5 (Testing)**: Vitest setup, integration tests for fetcher and server

### Out of Scope
- Cache persistence to disk (deferred to future PR)
- Full E2E test suite
- Migration of existing MCP clients

## Capabilities

### New Capabilities
- `error-resilience`: Retry with backoff, circuit breaker, typed errors (NetworkError, ParseError, NotFoundError)
- `bounded-cache`: LRU cache with max 100 entries, eviction, hit/miss tracking
- `selector-fallback`: Chain of CSS selectors per field with multiple pattern fallbacks
- `structured-logging`: JSON logger with request IDs, cache events, latency tracking
- `input-validation`: Zod schemas enforced at server registration level
- `version-detection`: Dynamic scraping of latest discord.js version from docs page
- `rate-limiting`: Request throttling (max 10 concurrent), site-rate awareness
- `pagination`: Cursor-based pagination for large result sets (search, list methods)
- `method-param-completeness`: getMethod() parses and returns parameters and code examples

### Modified Capabilities
- None (initial implementation)

## Approach

**Chain 1 (Foundation)**: Add typed errors, retry decorator, circuit breaker state machine, vitest config + tests
**Chain 2 (Cache + Observability)**: Replace Map with lru-cache library, add pino logger, emit cache events
**Chain 3 (Parsing)**: Extract selectors to config, add fallback chains per field, fix getMethod() parameter extraction
**Chain 4 (Server)**: Add server-level Zod validation middleware, parse version from docs, implement rate limiter + paginator
**Chain 5 (Integration)**: End-to-end tests covering error paths, cache behavior, selector fallbacks

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/fetcher.ts` | Modified | Error handling, LRU cache, selectors, parsing logic |
| `src/index.ts` | Modified | Input validation, logging, rate limiting setup |
| `src/errors.ts` | New | Typed error classes |
| `src/cache.ts` | New | LRU cache wrapper |
| `src/selectors.ts` | New | Selector configuration with fallbacks |
| `src/rate-limiter.ts` | New | Throttling implementation |
| `src/pagination.ts` | New | Pagination helpers |
| `src/version.ts` | New | Dynamic version detection |
| `tests/` | New | Vitest integration tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Selector changes break parsing | High | Fallback chains + integration tests in PR 3 |
| Rate limiting causes false throttling | Med | Configurable limits, test with mock server |
| LRU cache library adds deps | Low | Single well-maintained dep (lru-cache) |
| PR chain complexity | Med | Small incremental PRs, each independently testable |

## Rollback Plan

Each PR is independently rollbackable via `git revert`. PRs are sequenced so each builds on a stable base. If a later PR fails, prior PRs remain valid. Full revert available via `git revert HEAD~N` to the pre-refactor state.

## Dependencies

- Node.js 18+ (already required)
- New dep: `lru-cache` v7, `pino` v8, `pino-pretty`, `vitest`

## Success Criteria

- [ ] All 5 PRs merge with green CI
- [ ] Integration tests cover error paths (network failure, parse failure, not found)
- [ ] Cache hit/miss observable via logs
- [ ] getMethod() returns parameters and examples for documented methods
- [ ] Rate limiter prevents >10 concurrent requests
- [ ] Build passes: `npm run build --prefix packages/mcp-discordjs`