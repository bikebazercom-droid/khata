import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Integration tests talk to a real Postgres DB — run serially to avoid
    // inter-test interference and keep output readable.
    pool: "forks",
    singleFork: true,
    testTimeout: 30_000,
  },
});
