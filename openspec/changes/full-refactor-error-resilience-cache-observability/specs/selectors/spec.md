# Selectors Specification

## Purpose

Provides fallback selector chains for robust field extraction and pattern-based utilities for parsing discord.js.org documentation.

## Requirements

### Requirement: Primary + Fallback Selectors

The system SHALL define a selector chain per field with one primary selector and up to three fallback selectors. Extraction attempts each selector in order until one succeeds.

### Requirement: Selector Fallback Chain

For each extracted field (method name, description, parameters, examples), the system SHALL try up to 4 CSS selectors before failing.

### Requirement: Pattern-Based Extraction

The system SHALL provide pattern matching utilities to extract structured data from text content using RegExp patterns (e.g., parameter signatures, type annotations).

### Requirement: Selector Validation

The system SHALL validate selector chains during initialization and warn if any selector is syntactically invalid or matches nothing in test HTML.

### Requirement: Selector Testing Helpers

The system SHALL provide helper functions to test selectors against sample HTML and report match success/failure per selector in chain.

### Requirement: Selector Strategy Documentation

The system SHALL document the selector strategy including primary patterns, fallback rationale, and common failure modes.

## Scenarios

#### Scenario: Primary selector succeeds

- GIVEN a selector chain `['.method-name', '.doc-method h3', 'h3']` for method name
- WHEN the HTML contains an element matching `.method-name`
- THEN the first match is returned and no fallbacks are attempted

#### Scenario: Fallback selector used

- GIVEN a selector chain `['.method-name', '.doc-method h3', 'h3']` for method name
- WHEN the HTML contains no `.method-name` but contains `.doc-method h3`
- THEN `.doc-method h3` text is returned

#### Scenario: All fallbacks exhausted

- GIVEN a selector chain `['.method-name', '.doc-method h3', 'h3']` for method name
- WHEN no selector in the chain matches
- THEN extraction returns null and logs a ScrapingError with the failed chain

#### Scenario: Pattern extraction for parameters

- GIVEN a parameter string `'(user: User, guild: Guild, options?: Options)'`
- WHEN `extractParameters(pattern)` is called with `paramPattern`
- THEN an array of parameter objects `[{ name: 'user', type: 'User' }, { name: 'guild', type: 'Guild' }, { name: 'options', type: 'Options', optional: true }]` is returned

#### Scenario: Pattern extraction for type annotations

- GIVEN a return type string `': Promise<Message | Message[]>'`
- WHEN `extractReturnType(pattern)` is called
- THEN `'Promise<Message | Message[]>'` is returned

#### Scenario: Selector validation warns on invalid CSS

- GIVEN a selector `'div[invalidSyntax'` (missing closing bracket)
- WHEN validation runs
- THEN a WARN log is emitted identifying the syntax error

#### Scenario: Selector validation warns on zero matches

- GIVEN a selector `'.nonexistent-class-xyz'` with test HTML
- WHEN validation runs
- THEN a WARN log is emitted indicating the selector matches zero elements

#### Scenario: Selector test helper reports chain results

- GIVEN selector chain `['.name', '.doc h2']` and sample HTML
- WHEN `testSelectorChain(chain, html)` is called
- THEN results indicate which selectors matched and their matched values