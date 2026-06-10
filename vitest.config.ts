import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    env: {
      DB_ENV: "test",
    },
    fileParallelism: false,
    include: ["server/__tests__/**/*.test.ts", "src/ui/__tests__/**/*.test.{ts,tsx}"],
  },
});
