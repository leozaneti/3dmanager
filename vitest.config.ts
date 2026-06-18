import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "node-builtin",
      enforce: "pre",
      resolveId(id) {
        if (id === "node:sqlite" || id === "sqlite") {
          return { id: "node:sqlite", external: true };
        }
      },
    },
  ],
  test: {
    globals: true,
    env: {
      DB_ENV: "test",
    },
    fileParallelism: false,
    include: ["server/__tests__/**/*.test.ts", "src/ui/__tests__/**/*.test.{ts,tsx}"],
  },
});
