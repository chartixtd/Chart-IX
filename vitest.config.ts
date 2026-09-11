import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // .tsx 的组件测试走 esbuild 的 automatic runtime。tsconfig 里是 preserve
  // （Next 自己编译），vitest 直接用会报 React 未定义。
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "src/lib/**/*.test.ts",
      "src/stores/**/*.test.ts",
      // 组件测试。加这一条是因为警报栏的排序错位连着出过两次，而那种 bug
      // 只有把列表真渲染出来、看币名的先后顺序才验得到——纯逻辑测试碰不到。
      "src/components/**/*.test.tsx",
    ],
    environment: "node",
  },
});
