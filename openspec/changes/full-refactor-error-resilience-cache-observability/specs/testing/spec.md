# Testing Specification

## Purpose

Provides vitest setup, integration tests for fetcher, unit tests for cache LRU, and tests for retry/circuit breaker patterns.

## Requirements

### Requirement: Vitest Setup

The system SHALL have vitest configured with TypeScript support, coverage reporting (v8), and test match pattern `**/*.test.ts`.

### Requirement: Integration Tests for Fetcher

The system SHALL have integration tests covering: successful fetch, network failure, parse failure, not found (404), rate limit (429), and timeout scenarios.

### Requirement: Unit Tests for LRU Cache

The system SHALL have unit tests covering: basic get/set, LRU eviction order, max size enforcement, eviction callback, and cache hit/miss tracking.

### Requirement: Tests for Retry

The system SHALL have tests covering: successful first attempt, retry on failure, max attempts reached, backoff timing, and non-retryable errors (not in retry list).

### Requirement: Tests for Circuit Breaker

The system SHALL have tests covering: state transitions (closed→open→half-open→closed), failure threshold, reset timeout, and fast-fail when open.

## Scenarios

#### Scenario: Vitest runs tests with ts-node

- GIVEN vitest configured with tsx transformer
- WHEN `npm test` is executed
- THEN all `*.test.ts` files are loaded and executed

#### Scenario: Fetcher integration - successful fetch

- GIVEN a mock server returning valid HTML
- WHEN fetcher.scrape() is called
- THEN parsed result is returned without error

#### Scenario: Fetcher integration - network error

- GIVEN a mock server that closes connection
- WHEN fetcher.scrape() is called
- THEN a NetworkError is thrown with cause

#### Scenario: Fetcher integration - parse error

- GIVEN a mock server returning invalid HTML (malformed structure)
- WHEN fetcher.scrape() is called
- THEN a ScrapingError is thrown with selector context

#### Scenario: Fetcher integration - 404 not found

- GIVEN a mock server returning 404
- WHEN fetcher.scrape() is called
- THEN a NetworkError with status 404 is thrown

#### Scenario: Fetcher integration - 429 rate limited

- GIVEN a mock server returning 429 with Retry-After: 5
- WHEN fetcher.scrape() is called
- THEN a NetworkError with status 429 is thrown

#### Scenario: Cache unit - LRU eviction order

- GIVEN cache with `maxSize: 3`
- WHEN set(a), set(b), set(c), set(a), set(d) is called
- THEN b is evicted (a was accessed, making c the oldest)

#### Scenario: Cache unit - max size enforcement

- GIVEN cache with `maxSize: 3`
- WHEN 4 items are inserted
- THEN exactly 3 items remain and eviction callback was called once

#### Scenario: Retry - success on first try

- GIVEN an operation that succeeds immediately
- WHEN retry(operation, { maxAttempts: 3 }) is called
- THEN the result is returned without any retries

#### Scenario: Retry - retries on failure then succeeds

- GIVEN an operation that fails twice then succeeds
- WHEN retry(operation, { maxAttempts: 3, baseDelayMs: 10 }) is called
- THEN operation was called 3 times total and final result is returned

#### Scenario: Retry - max attempts exhausted

- GIVEN an operation that always fails
- WHEN retry(operation, { maxAttempts: 3, baseDelayMs: 10 }) is called
- THEN operation was called 3 times and final error is thrown

#### Scenario: Circuit breaker - opens after threshold

- GIVEN circuit breaker with `failureThreshold: 3`
- WHEN 3 consecutive operations fail
- THEN state is OPEN and 4th operation fails immediately without calling operation

#### Scenario: Circuit breaker - half-open after timeout

- GIVEN circuit breaker in OPEN state with `resetTimeoutMs: 100`
- WHEN 100ms elapses and a new request arrives
- THEN state is HALF_OPEN and request is allowed to proceed

#### Scenario: Circuit breaker - closes after success in half-open

- GIVEN circuit breaker in HALF_OPEN state
- WHEN a successful operation completes
- THEN state transitions to CLOSED and failure count resets to 0