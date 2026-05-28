# Tasks: full-refactor-error-resilience-cache-observability

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1200–1500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Error resilience primitives | PR 1 | Base types, retry, circuit breaker — no deps on later PRs |
| 2 | Cache + Observability | PR 2 | LRU cache, structured logger, metrics, tracer — depends on PR 1 |
| 3 | Selector Chain Refactor | PR 3 | Selectors, pattern extractor, validator — depends on PR 2 |
| 4 | Server Layer | PR 4 | Zod middleware, rate limiter, version detector, pagination — depends on PR 3 |
| 5 | Testing | PR 5 | vitest config, integration + unit tests — depends on PR 4 |

---

## Phase 1: PR 1 — Foundation

- [x] 1.1 Create `src/errors.ts` with `TypedError` base class and subclasses (`NetworkError`, `ScrapingError`, `CacheError`, `RateLimitError`) per foundation spec
- [x] 1.2 Create `src/result.ts` with `Result<T, E>` discriminated union, `ok()` and `err()` factories, `unwrap`/`unwrapErr` helpers
- [x] 1.3 Create `src/retry.ts` with `retry()` utility using exponential backoff (base 2, jitter, max 3 attempts) per foundation spec scenarios
- [x] 1.4 Create `src/circuit-breaker.ts` with 3-state machine (closed/open/half-open), threshold 5, reset 60s per foundation spec scenarios
- [ ] 1.5 Add no-new-dependencies note in PR 1 description (verified in review)

## Phase 2: PR 2 — Cache + Observability

- [x] 2.1 Install `lru-cache@^7.0.0` and `pino@^8.0.0` as dependencies in `package.json`
- [x] 2.2 Create `src/cache.ts` with bounded LRU cache (max 100), eviction callback, hit/miss tracking
- [x] 2.3 Create `src/logger.ts` with `StructuredLogger` class (pino JSON to stderr, pino-pretty in dev), correlation ID support
- [x] 2.4 Create `src/metrics.ts` with `MetricsCollector` for cache hit/miss ratio, request durations, error counts by type
- [x] 2.5 Create `src/tracer.ts` with `RequestTracer` generating UUID v4 correlation IDs
- [x] 2.6 Export new primitives from `src/index.ts` barrel

## Phase 3: PR 3 — Selectors

- [x] 3.1 Create `src/selectors.ts` with `SelectorChain`, `SelectorConfig`, and `extractWithChain()` function with fallback logic
- [x] 3.2 Create `src/patterns.ts` with `PatternExtractor` for parameter extraction, return type parsing, and example extraction from code blocks
- [x] 3.3 Create `src/selector-validator.ts` with `validateSelector()` and `testSelectorChain()` helpers
- [x] 3.4 Refactor `src/fetcher.ts` to use `SelectorChain` for field extraction instead of hardcoded selectors
- [x] 3.5 Add `__tests__/unit/selectors.test.ts` for selector chain fallback behavior per selectors spec

## Phase 4: PR 4 — Server Layer

- [x] 4.1 Create `src/validation.ts` with Zod validation middleware using existing `zod@^3.23.8` dependency
- [x] 4.2 Create `src/rate-limiter.ts` with sliding window rate limiter (10 req/min per IP) per server-layer spec
- [x] 4.3 Create `src/version-detector.ts` with `detectLatestVersion()` scraping from docs landing page
- [x] 4.4 Create `src/pagination.ts` with cursor-based pagination (20 items/page) per server-layer spec
- [x] 4.5 Update `src/index.ts` to wire Zod validation middleware and rate limiter into MCP tool handlers
- [x] 4.6 Enrich `getMethod()` in `src/fetcher.ts` to parse and return parameters, return type, and code examples

## Phase 5: PR 5 — Testing

- [x] 5.1 Create `vitest.config.ts` with TypeScript, ESM, coverage-v8, and test match `**/*.test.ts`
- [x] 5.2 Create `__tests__/integration/fetcher.test.ts` covering success, network failure, parse failure, 404, 429, timeout
- [x] 5.3 Create `__tests__/unit/cache.test.ts` covering LRU eviction order, max size enforcement, eviction callback
- [x] 5.4 Create `__tests__/unit/circuit-breaker.test.ts` covering state transitions (closed→open→half-open→closed), threshold, fast-fail
- [x] 5.5 Create `__tests__/helpers/mock-server.ts` for HTTP mocking with configurable responses
- [x] 5.6 Create `__tests__/helpers/cheerio.ts` for loading HTML fixtures in selector tests
- [x] 5.7 Add `npm test` script to `package.json` invoking vitest

---

## Dependency Order

```
PR 1 (Foundation)
  └─ PR 2 (Cache + Observability)
        └─ PR 3 (Selectors)
              └─ PR 4 (Server Layer)
                    └─ PR 5 (Testing)
```

## Key Files Affected

| File | PR | Action |
|------|----|--------|
| `src/errors.ts` | 1 | Create |
| `src/result.ts` | 1 | Create |
| `src/retry.ts` | 1 | Create |
| `src/circuit-breaker.ts` | 1 | Create |
| `src/cache.ts` | 2 | Create |
| `src/logger.ts` | 2 | Create |
| `src/metrics.ts` | 2 | Create |
| `src/tracer.ts` | 2 | Create |
| `src/selectors.ts` | 3 | Create |
| `src/patterns.ts` | 3 | Create |
| `src/selector-validator.ts` | 3 | Create |
| `src/fetcher.ts` | 3, 4 | Modify |
| `src/validation.ts` | 4 | Create |
| `src/rate-limiter.ts` | 4 | Create |
| `src/version-detector.ts` | 4 | Create |
| `src/pagination.ts` | 4 | Create |
| `src/index.ts` | 4 | Modify |
| `vitest.config.ts` | 5 | Create |
| `__tests__/**/*.test.ts` | 5 | Create |
| `package.json` | 2, 5 | Modify |