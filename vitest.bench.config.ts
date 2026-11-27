import { defineConfig } from "vitest/config";

// Benchmarks (`npm run bench`): plain Node, no DOM, not part of `npm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["bench/**/*.bench.ts"],
  },
});
