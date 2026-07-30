import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: [
      "src/lib/trading/**/*.test.ts",
      "src/lib/bingx/**/*.test.ts",
      "src/lib/chart/**/*.test.ts",
    ],
    environment: "node",
  },
});
