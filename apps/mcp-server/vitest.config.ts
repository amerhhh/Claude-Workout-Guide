import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/._*"], // exFAT AppleDouble ghosts
    testTimeout: 30000,
  },
});
