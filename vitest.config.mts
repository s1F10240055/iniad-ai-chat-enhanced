import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    // MCP の connect(30s)/loginToGoogle(90s) 上限をカバーするため十分に広く設定
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
