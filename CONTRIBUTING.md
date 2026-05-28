# Contributing to MCP Discord.js

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/bulzykrown/mcp-discordjs
cd mcp-discordjs

# Install dependencies
cd packages/mcp-discordjs
pnpm install

# Build
pnpm run build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch
```

## Project Structure

```
packages/
└── mcp-discordjs/           # Main MCP server package
    ├── src/
    │   ├── index.ts          # Server entry point
    │   ├── fetcher.ts        # API fetching & caching
    │   ├── logger.ts         # Structured logging
    │   ├── metrics.ts         # Metrics collection
    │   ├── tracer.ts         # Request tracing
    │   ├── cache.ts          # LRU cache
    │   ├── circuit-breaker.ts # Circuit breaker
    │   ├── errors.ts         # Typed errors
    │   ├── retry.ts          # Retry logic
    │   ├── result.ts          # Result type
    │   ├── rate-limiter.ts    # Rate limiting
    │   ├── version-detector.ts
    │   ├── pagination.ts
    │   ├── validation.ts
    │   ├── selectors.ts
    │   └── patterns.ts
    └── __tests__/            # Test suite
```

## Code Style

- TypeScript strict mode
- ESM modules
- Run `pnpm run build` before committing

## Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm run test:coverage

# Run tests in UI mode
pnpm run test:ui
```

## Commit Messages

We follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `test:` Test changes
- `refactor:` Code refactoring
- `perf:` Performance improvements

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Commit with a clear message
7. Push to your fork
8. Open a Pull Request

## Issues

Feel free to submit issues and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.