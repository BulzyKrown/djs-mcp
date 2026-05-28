# MCP Discord.js Documentation Server

A Model Context Protocol (MCP) server that provides intelligent access to discord.js documentation.

## Features

- **17 specialized tools** for searching and retrieving discord.js documentation
- **Fuzzy search** with Levenshtein typo tolerance (edit distance ≤ 2)
- **Multi-package support** - searches across all discord.js packages simultaneously
- **Intelligent autocomplete** for IDE integration
- **Type resolution** - recursively resolve type aliases to their base types
- **Class hierarchy** - inheritance tree and relationship discovery
- **Circuit breaker** pattern for resilient API calls
- **LRU caching** with stale-while-revalidate for optimal performance

## Installation

```bash
# From GitHub Packages (recommended)
npm install @bulzykrown/mcp-discordjs

# Quick test with npx
npx -y @bulzykrown/mcp-discordjs
```

### Manual Installation

If you need to install from source:

```bash
git clone https://github.com/bulzykrown/mcp-djs.git
cd mcp-djs/packages/mcp-discordjs
npm install
npm run build
```

## Configuration

### OpenCode

```json
{
  "mcpServers": {
    "discordjs": {
      "command": "npx",
      "args": ["-y", "@bulzykrown/mcp-discordjs"]
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "discordjs": {
      "command": "npx",
      "args": ["-y", "@bulzykrown/mcp-discordjs"]
    }
  }
}
```

## Available Tools

### Search Tools

| Tool | Description |
|------|-------------|
| `search_docs` | Search with fuzzy matching, typo tolerance, and type filtering |
| `search_all` | Search across ALL packages simultaneously |
| `autocomplete` | Fast prefix-based autocomplete for IDEs |

### Class/Interface Tools

| Tool | Description |
|------|-------------|
| `get_class` | Class documentation with methods and inheritance |
| `get_interface` | Interface documentation with properties |
| `get_enum` | Enum documentation with all values |
| `get_type` | Type alias with resolved type |
| `get_function` | Standalone function documentation |
| `get_namespace` | All items within a namespace |

### Navigation Tools

| Tool | Description |
|------|-------------|
| `get_method` | Method documentation or list all methods in a class |
| `get_hierarchy` | Class inheritance tree |
| `get_related` | Related items by naming patterns |

### Utility Tools

| Tool | Description |
|------|-------------|
| `list_packages` | All discord.js packages with versions |
| `get_versions` | Available versions for a package |
| `get_entrypoints` | Entry points for a package |
| `explain_type` | Recursive type resolution |
| `get_item_detail` | Detailed item information |
| `get_circuit_status` | Circuit breaker state |
| `get_version` | Latest discord.js version |

## Usage Examples

### Search for a class

```json
{
  "name": "search_docs",
  "arguments": {
    "query": "Client",
    "type": "class"
  }
}
```

### Get class with hierarchy

```json
{
  "name": "get_class",
  "arguments": {
    "className": "Client"
  }
}
```

### Fuzzy search with typo tolerance

```json
{
  "name": "search_docs",
  "arguments": {
    "query": "GatawayIntentBts",
    "typoTolerance": true
  }
}
```

### Autocomplete for IDE

```json
{
  "name": "autocomplete",
  "arguments": {
    "prefix": "Clien"
  }
}
```

### Search all packages

```json
{
  "name": "search_all",
  "arguments": {
    "query": "Collection",
    "limit": 5
  }
}
```

## Development

```bash
cd packages/mcp-discordjs
pnpm install
pnpm run build
pnpm test
```

## Architecture

```
src/
├── index.ts          # MCP server entry point
├── fetcher.ts        # API fetching and caching
├── logger.ts         # Structured logging
├── metrics.ts        # Metrics collection
├── tracer.ts        # Request tracing
├── cache.ts          # LRU cache implementation
├── circuit-breaker.ts # Circuit breaker pattern
├── errors.ts        # Typed errors
├── retry.ts         # Retry with backoff
├── result.ts        # Result type
├── rate-limiter.ts   # Rate limiting
├── version-detector.ts # Version detection
├── pagination.ts    # Pagination utilities
├── validation.ts    # Zod validation
├── selectors.ts     # CSS selector management
├── patterns.ts      # Pattern extraction
└── __tests__/       # Tests
```

## Packages

This repository is a monorepo containing:

- `packages/mcp-discordjs` - The MCP server for discord.js documentation

## License

Apache-2.0

## Links

- [discord.js](https://discord.js.org)
- [discord.js GitHub](https://github.com/discordjs/discord.js)
- [MCP Protocol](https://modelcontextprotocol.io)# djs-mcp
