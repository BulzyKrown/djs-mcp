# Foundation Specification

## Purpose

Provides error resilience primitives: typed errors, retry logic with exponential backoff, circuit breaker pattern, and a Result type for explicit error handling.

## Requirements

### Requirement: TypedError Base Class

The system SHALL provide a `TypedError` base class that captures error name, message, cause, and metadata. All custom errors SHALL extend this class.

### Requirement: NetworkError

The system SHALL throw `NetworkError` when HTTP requests fail due to connection issues, timeouts, or non-2xx responses.

### Requirement: ScrapingError

The system SHALL throw `ScrapingError` when HTML parsing or selector extraction fails.

### Requirement: CacheError

The system SHALL throw `CacheError` when cache operations fail (serialization, eviction, etc.).

### Requirement: Retry with Exponential Backoff

The system SHALL provide a `retry` utility that attempts an async operation up to `maxAttempts` times with exponential backoff between attempts. The backoff SHALL use base delay `min(1000 * 2^attempt, maxDelayMs)`.

### Requirement: Circuit Breaker

The system SHALL implement a circuit breaker with three states: CLOSED (normal), OPEN (failing), HALF_OPEN (testing). The breaker SHALL transition OPEN after `failureThreshold` consecutive failures and HALF_OPEN after `resetTimeoutMs`.

### Requirement: Result Type

The system SHALL provide a `Result<T, E>` type representing either a successful value `T` or an error `E`. Operations returning Result SHALL NOT throw exceptions.

## Scenarios

#### Scenario: NetworkError thrown on connection timeout

- GIVEN a fetch operation that times out
- WHEN the request exceeds the configured timeout
- THEN a `NetworkError` is thrown with `code: 'ETIMEDOUT'` and cause set to the underlying error

#### Scenario: NetworkError thrown on non-2xx response

- GIVEN a fetch operation receiving HTTP 503
- WHEN the response status is >= 400
- THEN a `NetworkError` is thrown with `status: 503` and `statusText: 'Service Unavailable'`

#### Scenario: ScrapingError thrown on selector failure

- GIVEN a scraping operation where the primary selector matches nothing
- WHEN all selector fallbacks also fail
- THEN a `ScrapingError` is thrown with the failed selector chain and page URL

#### Scenario: Retry respects backoff

- GIVEN an operation that fails twice then succeeds
- WHEN `retry(operation, { maxAttempts: 3, baseDelayMs: 100 })` is called
- THEN delays between attempts are approximately 100ms and 200ms

#### Scenario: Circuit breaker opens after failures

- GIVEN circuit breaker with `failureThreshold: 3` and `resetTimeoutMs: 1000`
- WHEN 3 consecutive operations fail
- THEN the breaker state transitions to OPEN and subsequent calls fail fast without attempting

#### Scenario: Circuit breaker half-open after timeout

- GIVEN circuit breaker in OPEN state
- WHEN `resetTimeoutMs` elapses
- THEN the breaker transitions to HALF_OPEN and allows one test request

#### Scenario: Result type handles success

- GIVEN a successful operation returning `string`
- WHEN wrapped in `Result.ok`
- THEN `.isOk()` returns `true` and `.value` contains the string

#### Scenario: Result type handles error

- GIVEN a failed operation throwing `NetworkError`
- WHEN wrapped in `Result.err`
- THEN `.isErr()` returns `true` and `.error` contains the NetworkError