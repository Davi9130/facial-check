import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // Barrels and type-only modules have no runtime logic to cover.
      exclude: ["src/**/index.ts", "src/types/**"],
      reporter: ["text-summary", "text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Coverage target: the build fails below these numbers.
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 90,
        lines: 92,
      },
    },
  },
});
