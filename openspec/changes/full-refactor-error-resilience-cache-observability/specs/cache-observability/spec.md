# Cache + Observability Specification

## Purpose

Provides bounded LRU cache with eviction and structured logging with metrics for cache hit/miss, request timing, and error counts.

## Requirements

### Requirement: Bounded LRU Cache

The system SHALL implement a cache with maximum 100 entries using LRU eviction policy. When capacity is exceeded, the least recently used entry SHALL be evicted.

### Requirement: Cache Eviction Logging

The system SHALL log each cache eviction with level WARN, including the evicted key and current cache size.

### Requirement: Structured Logger

The system SHALL provide a logger with levels ERROR, WARN, INFO, DEBUG. Each log entry SHALL include timestamp, level, message, and correlation ID when present.

### Requirement: Cache Hit/Miss Metrics

The system SHALL track and log cache hit and miss counts. A hit occurs when a requested key exists in cache; a miss occurs when the key is absent.

### Requirement: Request Timing

The system SHALL log request duration in milliseconds for all HTTP operations, tagged with the operation name and correlation ID.

### Requirement: Error Counts

The system SHALL increment error counters by type (NetworkError, ScrapingError, CacheError) and log them at ERROR level with context.

### Requirement: Request Tracing

The system SHALL assign a correlation ID (UUID v4) to each incoming request and propagate it through all log entries and child operations.

## Scenarios

#### Scenario: Cache respects max size of 100

- GIVEN cache with `maxSize: 100`
- WHEN 101 unique keys are inserted sequentially
- THEN exactly 100 entries remain and the first key was evicted

#### Scenario: LRU eviction on access pattern

- GIVEN cache with `maxSize: 3` containing keys [A, B, C] (A oldest)
- WHEN key A is accessed (read)
- AND key D is inserted
- THEN B is evicted (A was made most recently used, so C is oldest)
- AND cache contains [A, C, D]

#### Scenario: Cache hit logged at DEBUG

- GIVEN a cache containing key "method:getUser"
- WHEN that key is requested and found
- THEN a DEBUG log entry is emitted with `event: 'cache_hit', key: 'method:getUser'`

#### Scenario: Cache miss logged at DEBUG

- GIVEN a cache without key "method:getUser"
- WHEN that key is requested and not found
- THEN a DEBUG log entry is emitted with `event: 'cache_miss', key: 'method:getUser'`

#### Scenario: Request timing logged

- GIVEN a fetcher operation for URL "https://discord.js.org/docs"
- WHEN the request completes in 150ms
- THEN an INFO log entry is emitted with `event: 'request_complete', url, durationMs: 150`

#### Scenario: Error count incremented

- GIVEN a network failure during fetcher operation
- WHEN the error is logged
- THEN error counter for `NetworkError` is incremented
- AND ERROR log includes `errorType: 'NetworkError', count: 1`

#### Scenario: Correlation ID propagated

- GIVEN incoming request with correlation ID "abc-123"
- WHEN logger is invoked for any operation in that request chain
- THEN all log entries include `correlationId: 'abc-123'`