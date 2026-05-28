# Design: full-refactor-error-resilience-cache-observability

## Technical Approach

Five chained PRs, each building on a stable base. Each PR is independently testable and rollbackable. The architecture follows the existing MCP server pattern in `index.ts` (registerTool) and the scraping pattern in `fetcher.ts` (cheerio + fetch).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Error hierarchy | TypedError base + subclasses | Explicit error typing avoids catching generic Error |
| Result type | Success<T> \| Failure<E> discriminated union | Explicit error handling without try/catch |
| Retry backoff | Base 2, max 3 retries, jitter | Balance between resilience and latency |
| Circuit breaker | 3-state (closed/open/half-open), threshold 5, reset 60s | Standard pattern for external APIs |
| LRU implementation | Map + doubly-linked list, max 100 | No new dep; lru-cache v7 added in PR2 per proposal |
| Logger | pino JSON to stderr | Structured, fast, async-safe |
| Selector strategy | Chain of 1 primary + 3 fallbacks per field | Resilience against DOM changes |

## Data Flow

```
MCP Request → Correlation ID → Logger → RateLimiter → CircuitBreaker → Fetcher
                                              ↓              ↓
                                         Cache (LRU)   Retry (3x)
                                              ↓              ↓
                                       Cache Metrics    or Error (typed)
```

## PR 1: Foundation

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/errors.ts` | Create | TypedError, NetworkError, ScrapingError, CacheError, RateLimitError |
| `src/result.ts` | Create | Result<T, E>, Success, Failure, unwrap/unwrapErr helpers |
| `src/retry.ts` | Create | retry() utility with exponential backoff + jitter |
| `src/circuit-breaker.ts` | Create | CircuitBreaker class with closed/open/half-open states |

### API Signatures

```typescript
// errors.ts
class TypedError extends Error {
  constructor(name: string, message: string, cause?: Error, metadata?: Record<string, unknown>)
}
class NetworkError extends TypedError { status?: number; statusText?: string }
class ScrapingError extends TypedError { selector?: string; url?: string }
class CacheError extends TypedError {}
class RateLimitError extends TypedError { retryAfterMs?: number }

// result.ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }
const ok = <T>(value: T): Result<T, never>
const err = <E>(error: E): Result<never, E>

// retry.ts
async function retry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; shouldRetry?: (e: Error) => boolean }
): Promise<T>

// circuit-breaker.ts
class CircuitBreaker {
  constructor(options: { failureThreshold?: number; resetTimeoutMs?: number })
  async execute<T>(operation: () => Promise<T>): Promise<T>
  getState(): 'closed' | 'open' | 'half-open'
}
```

### Dependencies
- No new external dependencies for PR1

---

## PR 2: Cache + Observability

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/cache.ts` | Create | LRUCache class (Map + doubly-linked list) |
| `src/logger.ts` | Create | StructuredLogger with levels, JSON to stderr |
| `src/metrics.ts` | Create | MetricsCollector for cache/REST/errors |
| `src/tracer.ts` | Create | RequestTracer with correlation IDs |

### API Signatures

```typescript
// cache.ts
class LRUCache<K, V> {
  constructor(maxSize: number, onEvict?: (key: K, value: V) => void)
  get(key: K): V | undefined
  set(key: K, value: V): void
  has(key: K): boolean
  delete(key: K): boolean
  clear(): void
  size: number
}

// logger.ts
class StructuredLogger {
  constructor(options?: { level?: 'debug' | 'info' | 'warn' | 'error' })
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

// metrics.ts
interface CacheMetrics { hits: number; misses: number; hitRatio: number }
interface RequestMetrics { count: number; durationsMs: number[]; errorsByType: Record<string, number> }

// tracer.ts
class RequestTracer {
  generateCorrelationId(): string
  withCorrelationId<T>(id: string, fn: () => T): T
}
```

### Dependencies
- `lru-cache@^7.0.0` (for comparison/validation of manual implementation OR use manual impl)
- `pino@^8.0.0` and `pino-pretty@^10.0.0`

---

## PR 3: Selectors

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/selectors.ts` | Create | SelectorChain, selector configuration per field |
| `src/pattern-extractor.ts` | Create | PatternExtractor for regex-based text parsing |
| `src/selector-validator.ts` | Create | SelectorValidator and test helpers |

### API Signatures

```typescript
// selectors.ts
interface SelectorConfig {
  primary: string
  fallbacks?: [string] | [string, string] | [string, string, string]
}
type SelectorChain = Record<string, SelectorConfig>

function extractWithChain($: CheerioAPI, chain: SelectorChain, field: string): string | null

// pattern-extractor.ts
function extractParameters(text: string): Array<{ name: string; type: string; optional: boolean }>
function extractReturnType(text: string): string
function extractExamples(codeBlocks: string[]): string[]

// selector-validator.ts
interface ValidationResult { valid: boolean; matches: number; error?: string }
function validateSelector(selector: string, html: string): ValidationResult
function testSelectorChain(chain: SelectorChain, html: string): Record<string, ValidationResult>
```

### Dependencies
- No new external dependencies

---

## PR 4: Server Layer

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/validation.ts` | Create | Zod validation middleware |
| `src/rate-limiter.ts` | Create | Sliding window rate limiter (10 req/min per IP) |
| `src/version.ts` | Create | VersionDetector scraping version from docs page |
| `src/pagination.ts` | Create | Cursor-based pagination (20 items/page) |

### API Signatures

```typescript
// validation.ts
function createValidationMiddleware<T>(schema: z.ZodSchema<T>)
function validateInput<T>(schema: z.ZodSchema<T>, input: unknown): T

// rate-limiter.ts
class RateLimiter {
  constructor(options: { maxRequests?: number; windowMs?: number })
  async acquire(key?: string): Promise<void>
  isLimited(key?: string): boolean
}

// version.ts
async function detectLatestVersion(): Promise<string>

// pagination.ts
interface PaginatedResult<T> {
  items: T[]
  hasMore: boolean
  cursor: string | null
  total: number
}
function paginate<T>(items: T[], cursor: string | null, pageSize?: number): PaginatedResult<T>
```

### Dependencies
- `zod@^3.23.8` (already present)

---

## PR 5: Testing

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `vitest.config.ts` | Create | Vitest + TypeScript + ESM config |
| `src/__tests__/` | Create | Integration tests for fetcher |
| `src/__tests__/unit/` | Create | Unit tests for cache, retry, circuit breaker |
| `src/__tests__/helpers.ts` | Create | Mock server, cheerio test helpers |

### Test Structure

```
src/__tests__/
├── integration/
│   ├── fetcher.test.ts      # Network, parse, 404, 429, timeout
│   └── server.test.ts       # MCP server integration
├── unit/
│   ├── cache.test.ts        # LRU eviction, max size
│   ├── retry.test.ts        # Backoff timing, max attempts
│   └── circuit-breaker.test.ts  # State transitions
└── helpers/
    ├── mock-server.ts        # HTTP mock with configurable responses
    └── cheerio.ts           # Load HTML fixtures for selector testing
```

### Dependencies
- `vitest@^1.0.0`
- `@vitest/coverage-v8@^1.0.0`
- `nock@^13.0.0` (mock HTTP)

---

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | LRU cache, retry, circuit breaker, pattern extraction | Mock timers, direct function calls |
| Integration | Fetcher with mock HTTP, MCP server with mock transport | nock + mock MCP transport |
| E2E | Not in scope (per proposal) | — |

## Open Questions

- [ ] Should lru-cache dependency be added or manual Map+linked-list implementation? Proposal mentions adding it in PR2.
- [ ] pino-pretty dev dependency for development logs only? Should be optional.
- [ ] Rate limiter keying by IP — MCP server runs locally, is IP-based limiting appropriate?