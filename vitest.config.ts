import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.{js,ts}"],
    disableConsoleIntercept: true,
    testTimeout: 15000, // 15 seconds timeout for all tests
  },
});
