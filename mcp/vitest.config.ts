import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: { allow: [".."] }, // allow importing ../demo-server/
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/tools/**", "src/lib/**"],
      exclude: ["src/index.ts"],
    },
  },
});
