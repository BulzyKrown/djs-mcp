import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // TypeScript support
    globals: true,
    environment: "node",
    
    // ESM modules
    include: ["**/__tests__/**/*.test.ts"],
    
    // Coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts"],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
    
    // Test match patterns
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  
  // Build target for ESM
  build: {
    target: "node18",
  },
});