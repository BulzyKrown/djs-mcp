# Server Layer Specification

## Purpose

Provides server-level enforcement of input validation, rate limiting, dynamic version detection, and pagination for large result sets.

## Requirements

### Requirement: Zod Schema Enforcement

The system SHALL validate all tool inputs against Zod schemas at the MCP server level before passing to handlers. Invalid inputs SHALL return a structured error response.

### Requirement: Rate Limiter

The system SHALL limit concurrent requests to discord.js.org to maximum 10 per minute. Requests exceeding this limit SHALL be queued or rejected with rate limit error.

### Requirement: Dynamic Version Detection

The system SHALL scrape the current latest discord.js version from the docs landing page on startup and when version is requested.

### Requirement: Pagination for Search Results

The system SHALL paginate search results exceeding 20 items, returning first 20 with cursor for next page. Pagination metadata SHALL include `hasMore`, `cursor`, `total`.

### Requirement: getMethod() Completeness

The getMethod() function SHALL parse and return: method name, description, parameters (name, type, optional), return type, code examples, and aliases.

### Requirement: Rate Limit Respect

The system SHALL track rate limits from HTTP response headers and back off accordingly when 429 is received.

## Scenarios

#### Scenario: Valid input passes Zod validation

- GIVEN a tool call with valid input matching the Zod schema
- WHEN the request reaches the server handler
- THEN validation passes and the handler is invoked with parsed input

#### Scenario: Invalid input returns structured error

- GIVEN a tool call with input missing required field `version`
- WHEN Zod validation fails
- THEN response contains `{ error: 'Validation Error', details: [...] }` with field-level error messages

#### Scenario: Rate limiter allows within limit

- GIVEN rate limiter configured with `maxRequests: 10, windowMs: 60000`
- WHEN 10 requests are made within 1 minute
- THEN all 10 are allowed to proceed

#### Scenario: Rate limiter rejects over limit

- GIVEN rate limiter configured with `maxRequests: 10, windowMs: 60000`
- WHEN the 11th request arrives within 1 minute
- THEN it is rejected with rate limit error and retry-after hint

#### Scenario: Version detected from docs page

- GIVEN discord.js.org docs page shows "Latest: v14.11.0"
- WHEN dynamic version detection runs
- THEN returned version is "14.11.0"

#### Scenario: Search results paginated at 20

- GIVEN a search returning 50 items
- WHEN pagination is applied
- THEN first page returns items 0-19 with `hasMore: true` and `cursor: '20'`
- AND subsequent page with cursor returns items 20-39

#### Scenario: getMethod() returns all fields

- GIVEN a method page for `Client#emit`
- WHEN getMethod() parses the page
- THEN returned object contains: `{ name: 'emit', description: '...', parameters: [...], returnType: 'boolean', examples: [...], aliases: [] }`

#### Scenario: getMethod() parameters include optional flag

- GIVEN a method `Collection#get(key, defaultValue?)`
- WHEN parameters are extracted
- THEN each optional parameter has `optional: true`

#### Scenario: 429 response triggers backoff

- GIVEN a request receiving HTTP 429 with `Retry-After: 30`
- WHEN the rate limiter processes this
- THEN the next request is delayed by at least 30 seconds